-- 物料主数据表：库存健康度与采购成本分析的对象维度
-- 安全库存 / 订货点 / MOQ / 提前期是模拟器「补货策略」的输入，也是库存模块的判定基准。
-- 注意：abc_class 由模拟器按年消耗金额的帕累托分布（80 / 15 / 5）回填。
CREATE TABLE IF NOT EXISTS `material` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code`           VARCHAR(30)   NOT NULL                COMMENT '物料编码（唯一）',
  `name`           VARCHAR(100)  NOT NULL                COMMENT '物料名称',
  `category`       VARCHAR(30)   NOT NULL DEFAULT ''     COMMENT '物料类别：原料 / 辅料 / 包材 / 备件',
  `unit`           VARCHAR(10)   NOT NULL DEFAULT '件'   COMMENT '计量单位',
  `abc_class`      VARCHAR(2)    NOT NULL DEFAULT 'C'    COMMENT 'ABC 分类：A / B / C',
  `std_price`      DECIMAL(12,4) NOT NULL DEFAULT 0.0000 COMMENT '标准单价（元）',
  `safety_stock`   DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '安全库存',
  `reorder_point`  DECIMAL(14,2) NOT NULL DEFAULT 0.00   COMMENT '订货点（库存低于此值触发补货）',
  `moq`            DECIMAL(14,2) NOT NULL DEFAULT 1.00   COMMENT '最小起订量 MOQ（下单量需向上取整到该值）',
  `lead_time_days` INT           NOT NULL DEFAULT 7      COMMENT '采购提前期（天）',
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'active' COMMENT '状态：active 在用 / inactive 停用',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_material_code` (`code`),
  KEY `idx_material_abc` (`abc_class`),
  KEY `idx_material_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='物料主数据表';
