import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class YampiOrderAdapter {
  private readonly logger = new Logger(YampiOrderAdapter.name);
  private readonly apiUrl = 'https://api.dooki.com.br/v2';

  async getOrders(params: any): Promise<any[]> {
    try {
      const { token, merchantAlias, ...queryParams } = params;
      
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/orders`,
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

      this.logger.log(`Pedidos obtidos da Yampi: ${response.data.data.length}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter pedidos da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOrderDetails(orderData: any): Promise<any> {
    try {
      const { token, merchantAlias, orderId } = orderData;
      
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/orders/${orderId}?include=items,shipping,customer,payments`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Detalhes do pedido obtidos da Yampi: ${orderId}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter detalhes do pedido da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateOrderStatus(orderData: any, status: string): Promise<any> {
    try {
      const { token, merchantAlias, orderId } = orderData;
      
      const response = await axios.patch(
        `${this.apiUrl}/${merchantAlias}/orders/${orderId}`,
        { status: status },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Status do pedido atualizado na Yampi: ${orderId} -> ${status}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao atualizar status do pedido na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createOrder(order: any): Promise<any> {
    try {
      const { token, merchantAlias, ...orderData } = order;
      
      const response = await axios.post(
        `${this.apiUrl}/${merchantAlias}/orders`,
        orderData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Pedido criado na Yampi: ${response.data.data.id}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao criar pedido na Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOrderStatuses(merchantAlias: string, token: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/orders/statuses`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log('Status de pedidos obtidos da Yampi');
      return response.data.data;
    } catch (error) {
      this.logger.error(`Erro ao obter status de pedidos da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }
} 