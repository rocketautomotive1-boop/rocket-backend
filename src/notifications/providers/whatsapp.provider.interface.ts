/**
 * Interface universal para provedores WhatsApp
 * Permite trocar entre Baileys, Evolution, WPPConnect, etc
 */
export interface IWhatsAppProvider {
  /**
   * Envia uma mensagem de texto para um destinatário
   * @param destination Phone (5511999999999) ou Group ID (120363xxx@g.us)
   * @param text Conteúdo da mensagem
   */
  sendMessage(destination: string, text: string): Promise<void>;

  /**
   * Retorna se o provider está conectado
   */
  isConnected(): boolean;

  /**
   * Reconecta se desconectado
   */
  reconnect(): Promise<void>;

  /**
   * Obtém o status de conexão e informações do cliente
   */
  getStatus(): Promise<{
    connected: boolean;
    phoneNumber?: string;
    message?: string;
  }>;

  /**
   * Inicia o provider (setup inicial, QR code, etc)
   */
  initialize(): Promise<void>;

  /**
   * Encerra o provider gracefully
   */
  destroy(): Promise<void>;
}
