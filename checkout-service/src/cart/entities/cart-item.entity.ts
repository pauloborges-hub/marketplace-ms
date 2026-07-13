import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cart } from './cart.entity';

@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' })
  cart: Cart;

  @Column('uuid')
  cartId: string;

  @Column('uuid')
  productId: string;

  @Column({ length: 255 })
  productName: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) =>
        value === null ? value : parseFloat(value),
    },
  })
  price: number;

  @Column('int', { default: 1 })
  quantity: number;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) =>
        value === null ? value : parseFloat(value),
    },
  })
  subtotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
