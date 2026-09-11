-- 出入库流水表：库存数量变动的唯一事实来源，也是周转率与库存金额的核算依据
-- 方向约定：in / out 两类一律存正数，方向由 flow_type 表达；adjust（盘点调整）存带符号增量。
--   期末数量 = 期初数量 + SUM(in) + SUM(adjust带符号) - SUM(out)
-- 勾稽关系：采购入库流水的 ref_no 指向 purchase_order.order_no，且入库总量 = 订单实收总量。
CREATE TABLE IF NOT EXISTS `inventory_flow` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `flow_date`   DATE          NOT NULL                COMMENT '业务发生日期',
  `material_id` INT UNSIGNED  NOT NULL                COMMENT '物料 ID（逻辑关联 material.id）',
  `flow_type`   VARCHAR(10)   NOT NULL                COMMENT '流水类型：in 入库 / out 出库 / adjust 盘点调整',
  `qty`         DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '数量（in / out 存正数，adjust 存带符号增量）',
  `unit_price`  DECIMAL(12,4) NOT NULL DEFAULT 0.0000 COMMENT '单价（元）',
  `amount`      DECIMAL(16,2) NOT NULL DEFAULT 0.00   COMMENT '金额 = 数量 × 单价',
  `ref_type`    VARCHAR(30)   NOT NULL DEFAULT ''     COMMENT '来源类型：purchase 采购入库 / produce 生产领用 / sales 销售出库 / check 盘点',
  `ref_no`      VARCHAR(40)   NOT NULL DEFAULT ''     COMMENT '来源单号（采购入库时填订单号）',
  `supplier_id` INT UNSIGNED  DEFAULT NULL            COMMENT '供应商 ID（仅采购入库有值）',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '写入时间',
  PRIMARY KEY (`id`),
  KEY `idx_flow_material_date` (`material_id`, `flow_date`),
  KEY `idx_flow_date` (`flow_date`),
  KEY `idx_flow_type` (`flow_type`),
  KEY `idx_flow_ref_no` (`ref_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出入库流水表';
