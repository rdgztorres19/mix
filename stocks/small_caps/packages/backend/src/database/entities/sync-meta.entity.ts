import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('sync_meta')
export class SyncMetaEntity {
  @PrimaryColumn({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  candle_rows!: number;

  @Column({ type: 'int', default: 0 })
  news_rows!: number;

  @Column({ type: 'datetime', nullable: true })
  synced_at!: Date | null;
}
