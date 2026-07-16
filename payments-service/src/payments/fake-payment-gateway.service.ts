import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

export interface GatewayResult {
  approved: boolean;
  transactionId: string;
  rejectionReason?: string;
}

/**
 * Simula um gateway de pagamento externo — inteiramente in-process.
 * Não faz nenhuma chamada de rede: apenas aplica regras determinísticas
 * sobre o valor e adiciona uma latência artificial para imitar a resposta
 * de um provedor real.
 */
@Injectable()
export class FakePaymentGatewayService {
  private readonly logger = new Logger(FakePaymentGatewayService.name);

  private static readonly LIMIT = 10000;
  private static readonly MIN_LATENCY_MS = 500;
  private static readonly MAX_LATENCY_MS = 2000;

  async process(amount: number): Promise<GatewayResult> {
    await this.simulateLatency();

    const transactionId: string = `txn_${randomUUID()}`;

    // RN1 tem precedência sobre RN2 (RN3): avaliar limite antes do ".99".
    if (amount > FakePaymentGatewayService.LIMIT) {
      this.logger.warn(`Payment rejected (amount ${amount} exceeds limit)`);

      return {
        approved: false,
        transactionId,
        rejectionReason: 'Limite excedido',
      };
    }

    // RN2 — valor terminado em .99, comparando em centavos para evitar
    // erros de precisão de ponto flutuante.
    if (Math.round(amount * 100) % 100 === 99) {
      this.logger.warn(`Payment rejected (amount ${amount} ends in .99)`);

      return {
        approved: false,
        transactionId,
        rejectionReason: 'Cartão recusado pela operadora',
      };
    }

    // RN4 — qualquer outro valor é aprovado.
    return {
      approved: true,
      transactionId,
    };
  }

  private async simulateLatency(): Promise<void> {
    const { MIN_LATENCY_MS, MAX_LATENCY_MS } = FakePaymentGatewayService;
    const delay: number =
      Math.floor(Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS + 1)) +
      MIN_LATENCY_MS;

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}
