export interface PaymentResultMessage {
  orderId: string;
  userId: string;
  status: 'approved' | 'rejected';
  amount: number;
  paymentMethod: string;
  transactionId: string | null;
  rejectionReason: string | null;
  processedAt: string;
  metadata?: {
    service: string;
    timestamp: string;
  };
}
