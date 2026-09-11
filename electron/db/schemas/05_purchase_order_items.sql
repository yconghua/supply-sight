-- 采购订单明细表：单价与质量数据的唯一来源
-- received_qty / qualified_qty / defect_qty 三个字段刻意拆开存，原因是：
--   PPM（百万分之不良率）= defect_qty / received_qty * 1000000，直接可算，不必回表推断；
--   合格率 = qualified_qty / received_qty，同理。
-- 恒等关系：qualified_qty + defect_qty = received_qty（模拟器写入时保证，自检项之一）。
CREATE TABLE IF NOT EXISTS `purchase_order_item` (
  `id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_id`      INT UNSIGNED  NOT NULL                COMMENT '所属订单 ID（逻辑关联 purchase_order.id）',
  `material_id`   INT UNSIGNED  NOT NULL                COMMENT '物料 ID（逻辑关联 material.id）',
  `qty`           DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '下单数量',
  `unit_price`    DECIMAL(12,4) NOT NULL DEFAULT 0.0000 COMMENT '采购单价（元）',
  `amount`        DECIMAL(16,2) NOT NULL DEFAULT 0.00   COMMENT '金额 = 下单数量 × 采购单价',
  `received_qty`  DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '实收数量（到货后回填）',
  `qualified_qty` DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '合格数量（到货后回填）',
  `defect_qty`    DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '不良数量（到货后回填）',
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_poi_order` (`order_id`),
  KEY `idx_poi_material` (`material_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采购订单明细表';
