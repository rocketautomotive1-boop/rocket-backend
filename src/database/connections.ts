// backend/src/database/connections.ts

/**
 * Nome da conexão Mongoose para o domínio de itens gerais (saúde, beleza,
 * bebidas, alimentos). Banco físico separado de autopeças.
 *
 * Schemas do domínio geral devem registrar com:
 *   MongooseModule.forFeature([...], GENERAL_CONNECTION)
 * e injetar com:
 *   @InjectModel(Name, GENERAL_CONNECTION)
 *
 * A conexão default (sem nome) continua servindo autopeças — não usar esta
 * constante lá.
 */
export const GENERAL_CONNECTION = 'general';
