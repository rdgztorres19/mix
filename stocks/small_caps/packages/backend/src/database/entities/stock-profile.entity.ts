import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('stock_profile')
export class StockProfileEntity {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  symbol!: string;

  @Column({ type: 'bigint', nullable: true })
  shares_outstanding!: number | null;

  @Column({ type: 'decimal', precision: 16, scale: 4, nullable: true })
  market_cap!: number | null;
}
