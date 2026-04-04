import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('candle_1m')
@Index('idx_sym_date_candle', ['symbol', 'date', 'candle_idx'], { unique: true })
@Index('idx_date', ['date'])
export class Candle1mEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 16 })
  symbol!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'smallint' })
  candle_idx!: number;

  @Column({ type: 'varchar', length: 5 })
  candle_time_et!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  open!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  high!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  low!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  close!: number;

  @Column({ type: 'bigint' })
  volume!: number;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  vwap!: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  ema9!: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 6, nullable: true })
  ema20!: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  atr!: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  high_of_day!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  low_of_day!: number;

  @Column({ type: 'varchar', length: 32 })
  session!: string;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  gap_pct!: number | null;

  @Column({ type: 'bigint', nullable: true })
  premarket_volume!: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  pre_market_high!: number | null;

  @Column({ type: 'bigint' })
  timestamp_ms!: number;
}
