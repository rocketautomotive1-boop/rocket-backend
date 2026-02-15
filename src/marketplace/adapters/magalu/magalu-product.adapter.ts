import { Injectable, HttpException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class MagaluProductAdapter {
  private baseUrl = process.env.MAGALU_BASE_URL || 'https://api.magalu.com';

  private client(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: this.baseUrl,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async getCategories(accessToken: string) {
    try {
      const api = this.client(accessToken);
      const res = await api.get('/catalog/categories'); // ajuste conforme docs
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data || 'Magalu categories error', e.response?.status || 500);
    }
  }

  async getCategoryAttributes(accessToken: string, categoryId: string) {
    try {
      const api = this.client(accessToken);
      const res = await api.get(`/catalog/categories/${categoryId}/attributes`); // ajuste conforme docs
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data || 'Magalu attributes error', e.response?.status || 500);
    }
  }

  async upsertProduct(accessToken: string, payload: any) {
    try {
      const api = this.client(accessToken);
      // Ex.: criação/atualização de produto
      const res = await api.post(`/products`, payload); // ajuste conforme docs
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data || 'Magalu product upsert error', e.response?.status || 500);
    }
  }

  async publishListing(accessToken: string, productExternalId: string) {
    try {
      const api = this.client(accessToken);
      const res = await api.post(`/listings`, { productId: productExternalId }); // ajuste conforme docs
      return res.data;
    } catch (e: any) {
      throw new HttpException(e.response?.data || 'Magalu publish error', e.response?.status || 500);
    }
  }
}