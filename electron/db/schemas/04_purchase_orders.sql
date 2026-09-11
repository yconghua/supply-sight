-- 采购订单主表：由「库存跌破订货点」的补货动作产生，是供应商绩效分析的主线单据。
-- 准时交付（OTD）判定依赖 promised_date 与 actual_date 两个字段：
--   实际到货日 <= 承诺交期 记为准时；未到货（actual_date 为 NULL）不参与 OTD 分母统计。
-- 订单金额 total_amount 冗余存一份，避免列表页每次都去汇总明细。
CREATE TABLE IF NOT EXISTS `purchase_order` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_no`      VARCHAR(40)   NOT NULL                COMMENT '订单号（唯一）',
  `supplier_id`   INT UNSIGNED  NOT NULL                COMMENT '供应商 ID（逻辑关联 supplier.id）',
  `order_date`    DATE          NOT NULL                COMMENT '下单日期',
  `promised_date` DATE          NOT NULL                COMMENT '承诺交期',
  `actual_date`   DATE          DEFAULT NULL            COMMENT '实际到货日期（在途为 NULL）',
  `total_amount`  DECIMAL(16,2) NOT NULL DEFAULT 0.00   COMMENT '订单金额（明细汇总，冗余字段）',
  `status`        VARCHAR(20)   NOT NULL DEFAULT 'pending' COMMENT '状态：pending 在途 / received 已到货 / canceled 已取消',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_po_order_no` (`order_no`),
  KEY `idx_po_supplier` (`supplier_id`),
  KEY `idx_po_order_date` (`order_date`),
  KEY `idx_po_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单主表';
