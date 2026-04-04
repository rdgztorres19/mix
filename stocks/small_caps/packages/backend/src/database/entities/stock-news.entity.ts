import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('stock_news')
@Index('idx_news_sym_date', ['symbol', 'date'])
export class StockNewsEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'bigint', nullable: true })
  news_id!: number | null;

  @Column({ type: 'varchar', length: 16 })
  symbol!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'text', nullable: true })
  headline!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source!: string | null;

  @Column({ type: 'datetime', nullable: true })
  created_at!: Date | null;
}
