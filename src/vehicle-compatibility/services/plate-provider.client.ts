import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, timeout } from 'rxjs';

export interface PlateProviderResult {
  make: string;
  model: string;
  year?: number;
  fuel?: string;
  engine?: string;
  raw: Record<string, any>;
}

@Injectable()
export class PlateProviderClient {
  private readonly logger = new Logger(PlateProviderClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async fetch(plate: string): Promise<PlateProviderResult | null> {
    const apiKey = this.configService.get<string>('PLATE_LOOKUP_API_KEY');
    if (!apiKey) {
      this.logger.warn('PLATE_LOOKUP_API_KEY não configurada — resolução por placa desabilitada');
      return null;
    }

    const url = `https://placas.fipeapi.com.br/placas/${plate}`;

    try {
      const response$ = this.httpService.get(url, { params: { key: apiKey } }).pipe(timeout(5000));
      const response = await lastValueFrom(response$);
      const data = response.data;

      if (!data || !data.marca || !data.modelo) {
        return null;
      }

      return {
        make: data.marca,
        model: data.modelo,
        year: data.ano ? Number(data.ano) : undefined,
        fuel: data.combustivel,
        engine: data.motor,
        raw: data,
      };
    } catch (err) {
      this.logger.warn(`Falha ao consultar provedor de placa (${plate}): ${err?.message}`);
      return null;
    }
  }
}
