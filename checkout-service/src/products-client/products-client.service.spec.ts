import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import {
  ProductNotFoundError,
  ProductResponse,
  ProductsClientService,
  ProductsServiceUnavailableError,
} from './products-client.service';

describe('ProductsClientService', () => {
  let service: ProductsClientService;
  let httpService: { get: jest.Mock };

  const productId = '11111111-1111-1111-1111-111111111111';
  const product: ProductResponse = {
    id: productId,
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 99.9,
    stock: 10,
    isActive: true,
    sellerId: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const axiosErrorWithStatus = (status: number): AxiosError =>
    new AxiosError(
      `HTTP ${status}`,
      'ERR',
      undefined,
      undefined,
      { status } as AxiosResponse,
    );

  beforeEach(async () => {
    httpService = { get: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ProductsClientService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(ProductsClientService);
  });

  it('fetches the product from GET /products/:id and returns its data (CA1)', async () => {
    httpService.get.mockReturnValue(
      of({ data: product } as AxiosResponse<ProductResponse>),
    );

    const result = await service.findProduct(productId);

    expect(httpService.get).toHaveBeenCalledWith(`/products/${productId}`);
    expect(result).toEqual(product);
  });

  it('throws ProductNotFoundError when products-service responds 404 (CA2)', async () => {
    httpService.get.mockReturnValue(throwError(() => axiosErrorWithStatus(404)));

    await expect(service.findProduct(productId)).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
  });

  it('throws ProductsServiceUnavailableError for a non-404 HTTP error (CA3)', async () => {
    httpService.get.mockReturnValue(throwError(() => axiosErrorWithStatus(500)));

    await expect(service.findProduct(productId)).rejects.toBeInstanceOf(
      ProductsServiceUnavailableError,
    );
  });

  it('throws ProductsServiceUnavailableError for a network error with no HTTP response (CA3)', async () => {
    httpService.get.mockReturnValue(
      throwError(() => new Error('ECONNREFUSED')),
    );

    await expect(service.findProduct(productId)).rejects.toBeInstanceOf(
      ProductsServiceUnavailableError,
    );
  });

  it('keeps "not found" and "unavailable" as distinct error types (CA2/CA3)', () => {
    expect(new ProductNotFoundError(productId)).not.toBeInstanceOf(
      ProductsServiceUnavailableError,
    );
    expect(new ProductsServiceUnavailableError(productId)).not.toBeInstanceOf(
      ProductNotFoundError,
    );
  });
});
