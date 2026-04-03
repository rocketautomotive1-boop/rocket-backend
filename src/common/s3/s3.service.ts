import { Injectable, Inject, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private readonly logger = new Logger(S3Service.name);
  private readonly bucket: string;
  private region: string;
  private readonly endpoint?: string;

  constructor(
    @Inject('S3_CONFIG') private readonly s3Config: any,
  ) {
    this.s3Client = new S3Client({
      region: s3Config.region,
      credentials: s3Config.credentials,
    });
    this.bucket = s3Config.bucket;
    this.region = s3Config.region;
    this.endpoint = s3Config.endpoint;
  }

  /**
   * Verifica se a conexão com o S3 está ativa
   */
  async ping(): Promise<boolean> {
    try {
      await this.s3Client.config.credentials();
      return true;
    } catch (error) {
      this.logger.error(`S3 Ping failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Faz upload de um arquivo para o Amazon S3
   * @param file Buffer do arquivo
   * @param key Nome do arquivo no S3 (incluindo caminho)
   * @param contentType Tipo de conteúdo do arquivo
   * @returns URL do arquivo no S3
   */
  async uploadFile(file: Buffer, key: string, contentType: string, useExactKey: boolean = false): Promise<string> {
    // Preparar dados reutilizáveis
    const uniqueKey = useExactKey ? key : this.generateUniqueKey(key);
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: uniqueKey,
        Body: file,
        ContentType: contentType,
        ACL: 'public-read',
      });
      await this.s3Client.send(command);
      return this.buildPublicUrl(uniqueKey);
    } catch (error) {
      this.logger.error(`Erro ao fazer upload para S3: ${error.message}`, error.stack);
      if (error?.name === 'PermanentRedirect' || error?.$metadata?.httpStatusCode === 301) {
        await this.ensureCorrectRegion();
        const retryCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: uniqueKey,
          Body: file,
          ContentType: contentType,
          ACL: 'public-read',
        });
        await this.s3Client.send(retryCommand);
        return this.buildPublicUrl(uniqueKey);
      }
      throw error;
    }
  }

  /**
   * Gera uma URL assinada para acesso temporário a um arquivo privado
   * @param key Nome do arquivo no S3
   * @param expiresIn Tempo de expiração em segundos
   * @returns URL assinada
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      this.logger.error(`Erro ao gerar URL assinada: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Remove um arquivo do S3
   * @param key Nome do arquivo no S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Erro ao excluir arquivo do S3: ${error.message}`, error.stack);
      if (error?.name === 'PermanentRedirect' || error?.$metadata?.httpStatusCode === 301) {
        await this.ensureCorrectRegion();
        const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
        await this.s3Client.send(command);
        return;
      }
      throw error;
    }
  }

  /**
   * Remove todos os arquivos de uma pasta do S3
   * @param prefix Prefixo da pasta (ex: products/123/)
   */
  async deleteFolder(prefix: string): Promise<void> {
    try {
      // Garantir que o prefixo termine com /
      const folderPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

      this.logger.log(`Limpando pasta S3 com prefixo: ${folderPrefix}`);

      let continuationToken = undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: folderPrefix,
          ContinuationToken: continuationToken,
        });

        const response = await this.s3Client.send(command);

        if (response.Contents && response.Contents.length > 0) {
          this.logger.log(`Encontrados ${response.Contents.length} arquivos para excluir em ${folderPrefix}`);

          // Excluir cada arquivo encontrado
          // Usamos Promise.all para deletar em paralelo para melhor performance
          await Promise.all(
            response.Contents.map(file => {
              if (file.Key) {
                return this.deleteFile(file.Key);
              }
              return Promise.resolve();
            })
          );
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      this.logger.log(`Pasta ${folderPrefix} limpa com sucesso`);
    } catch (error) {
      this.logger.error(`Erro ao limpar pasta S3: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Sincroniza uma pasta, mantendo apenas os arquivos especificados e excluindo o resto
   * @param prefix Prefixo da pasta
   * @param keepKeys Lista de chaves (caminhos completos) para MANTER
   */
  async syncFolder(prefix: string, keepKeys: string[]): Promise<void> {
    try {
      const folderPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
      this.logger.log(`Sincronizando pasta ${folderPrefix}. Mantendo ${keepKeys.length} arquivos.`);

      let continuationToken = undefined;

      // Normalizar keepKeys para garantir comparação correta
      const normalizedKeepKeys = new Set(keepKeys);

      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: folderPrefix,
          ContinuationToken: continuationToken,
        });

        const response = await this.s3Client.send(command);

        if (response.Contents && response.Contents.length > 0) {
          const toDelete = response.Contents.filter(file => file.Key && !normalizedKeepKeys.has(file.Key));

          if (toDelete.length > 0) {
            this.logger.log(`Excluindo ${toDelete.length} arquivos obsoletos em ${folderPrefix}`);
            await Promise.all(
              toDelete.map(file => this.deleteFile(file.Key!))
            );
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

    } catch (error) {
      this.logger.error(`Erro ao sincronizar pasta S3: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Gera um nome único para o arquivo
   * @param originalKey Nome original do arquivo
   * @returns Nome único
   */
  private generateUniqueKey(originalKey: string): string {
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(`${originalKey}${timestamp}`).digest('hex');

    // Extrair extensão do arquivo original
    const extension = originalKey.split('.').pop();
    const basePath = originalKey.substring(0, originalKey.lastIndexOf('/') + 1);

    return `${basePath}${hash}.${extension}`;
  }

  private buildPublicUrl(key: string): string {
    if (this.endpoint) {
      const base = this.endpoint.replace(/\/$/, '');
      return `${base}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private async ensureCorrectRegion(): Promise<void> {
    try {
      const location = await this.s3Client.send(new GetBucketLocationCommand({ Bucket: this.bucket }));
      const bucketRegion = location.LocationConstraint || 'us-east-1';
      (this as any).s3Client = new S3Client({
        region: bucketRegion,
        credentials: this.s3Config.credentials,
      });
      (this as any).region = bucketRegion;
      this.logger.log(`S3 região ajustada para bucket '${this.bucket}': ${bucketRegion}`);
    } catch (err) {
      this.logger.error(`Falha ao obter região do bucket ${this.bucket}: ${err.message}`);
      throw err;
    }
  }
}