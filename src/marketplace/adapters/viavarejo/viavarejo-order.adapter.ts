import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ViaVarejoOrderAdapter {
  private readonly logger = new Logger(ViaVarejoOrderAdapter.name);
  private readonly apiUrl = 'https://api.grupocasasbahia.com.br';

  async getOrders(params: any): Promise<any[]> {
    try {
      const { token, sellerId, ...queryParams } = params;
      
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params: {
            limit: queryParams.limit || 10,
            page: queryParams.page || 1,
            status: queryParams.status,
            created_at_min: queryParams.created_at_min,
            created_at_max: queryParams.created_at_max,
            include: queryParams.include || 'items,shipping,customer'
          }
        }
      );

      this.logger.log(`Pedidos obtidos da Via Varejo: ${response.data.data.length}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter pedidos da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOrderDetails(orderData: any): Promise<any> {
    try {
      const { token, sellerId, orderId } = orderData;
      
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders/${orderId}?include=items,shipping,customer,payments`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Detalhes do pedido obtidos da Via Varejo: ${orderId}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter detalhes do pedido da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateOrderStatus(orderData: any, status: string): Promise<any> {
    try {
      const { token, sellerId, orderId } = orderData;
      
      const response = await axios.patch(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders/${orderId}`,
        { status: status },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Status do pedido atualizado na Via Varejo: ${orderId} -> ${status}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar status do pedido na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createOrder(order: any): Promise<any> {
    try {
      const { token, sellerId, ...orderData } = order;
      
      const response = await axios.post(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders`,
        orderData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Pedido criado na Via Varejo: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar pedido na Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOrderStatuses(sellerId: string, token: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders/statuses`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log('Status de pedidos obtidos da Via Varejo');
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter status de pedidos da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOrderTracking(orderId: string, sellerId: string, token: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/orders/${orderId}/tracking`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Tracking do pedido obtido da Via Varejo: ${orderId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao obter tracking do pedido da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }
} 