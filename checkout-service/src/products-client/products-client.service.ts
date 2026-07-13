import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';

export interface ProductResponse {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  isActive: boolean;
  sellerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Produto inexistente no products-service (resposta 404). Distinguível de uma
 * falha de comunicação para que o chamador reporte 404 ao cliente.
 */
export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Produto ${productId} não encontrado no products-service.`);
    this.name = 'ProductNotFoundError';
  }
}

/**
 * products-service indisponível (rede, timeout ou erro diferente de 404).
 * Distinguível de "produto não encontrado" para que o chamador reporte uma
 * falha de dependência externa.
 */
export class ProductsServiceUnavailableError extends Error {
  constructor(productId: string, cause?: unknown) {
    super(
      `products-service indisponível ao buscar o produto ${productId}.`,
      { cause },
    );
    this.name = 'ProductsServiceUnavailableError';
  }
}

@Injectable()
export class ProductsClientService {
  constructor(private readonly httpService: HttpService) {}

  async findProduct(productId: string): Promise<ProductResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<ProductResponse>(`/products/${productId}`),
      );
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new ProductNotFoundError(productId);
      }
      throw new ProductsServiceUnavailableError(productId, error);
    }
  }
}
