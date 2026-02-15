export interface CorreiosAuthPayload {
    numero: string; // Contrato
    codigo: string; // Senha do Contrato (Código de Acesso API)
}

export interface CorreiosTokenResponse {
    ambiente: string;
    id: string;
    ip: string;
    perfil: string;
    cnpj: string;
    token: string;
    emissao: string;
    expiraEm: string;
    zoneOffset: string;
}

export interface CorreiosPriceParams {
    nuContrato: string;
    nuDR: string; // Diretoria Regional check documentation? Optional often.
    cepOrigem: string;
    cepDestino: string;
    coProduto: string; // Service Code
    psObjeto: string; // Weight in grams
    tpObjeto: string; // '1' = Box/Package, '2' = Prism/Roll, '3' = Envelope
    comprimento: string;
    largura: string;
    altura: string;
    diametro: string;
    vlDeclarado: string; // Optional
    dtEvento?: string; // Date of postingDD-MM-YYYY
}

export interface CorreiosPriceResponse {
    coProduto: string;
    pcBase: string;
    pcBaseGeral: string;
    pcFaixaCep: string;
    pcFaixaPeso: string;
    pcFinal: string; // This is the price
    peAdValorem: string;
    // ... many other fields
    txErro?: string;
    msgErro?: string;
}

export interface CorreiosDeadlineParams {
    coProduto: string;
    cepOrigem: string;
    cepDestino: string;
    dtEvento: string; // DD-MM-YYYY
}

export interface CorreiosDeadlineResponse {
    coProduto: string;
    prazoEntrega: string; // Days
    dataMaxEntrega: string;
    msgErro?: string;
    // ...
}
