-- 月度库存快照表：按「物料 × 账期」汇总的期末库存，库存健康度模块直接读这张表
-- 勾稽恒等式（模拟器页会显式自检）：end_qty = begin_qty + in_qty - out_qty
--   且 begin_qty(本期) = end_qty(上期)，逐月串联。
-- amount = end_qty × unit_price，是回答「库存压了多少钱」的直接依据。
-- 唯一键 (period, material_id) 保证同一物料同一账期只有一条快照。
CREATE TABLE IF NOT EXISTS `inventory_snapshot` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `period`      CHAR(7)       NOT NULL                COMMENT '账期，格式 YYYY-MM',
  `material_id` INT UNSIGNED  NOT NULL                COMMENT '物料 ID（逻辑关联 material.id）',
  `begin_qty`   DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '期初数量',
  `in_qty`      DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '本期入库数量合计',
  `out_qty`     DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '本期出库数量合计',
  `end_qty`     DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '期末数量 = 期初 + 入 - 出',
  `unit_price`  DECIMAL(12,4) NOT NULL DEFAULT 0.0000 COMMENT '期末单价（元）',
  `amount`      DECIMAL(16,2) NOT NULL DEFAULT 0.00   COMMENT '期末库存金额 = 期末数量 × 期末单价',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '写入时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_snap_period_material` (`period`, `material_id`),
  KEY `idx_snap_material` (`material_id`),
  KEY `idx_snap_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度库存快照表';
