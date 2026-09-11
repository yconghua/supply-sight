-- 供应商主数据表：供应商绩效分析的对象维度
-- 幂等：重复执行无副作用；新增表只需在 schemas/ 下加一个「NN_表名.sql」文件，主初始化代码零改动。
CREATE TABLE IF NOT EXISTS `supplier` (
  `id`             INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code`           VARCHAR(30)   NOT NULL                COMMENT '供应商编码（唯一）',
  `name`           VARCHAR(100)  NOT NULL                COMMENT '供应商名称',
  `category`       VARCHAR(30)   NOT NULL DEFAULT ''     COMMENT '供应类别：原料 / 辅料 / 包材 / 外协',
  `contact_person` VARCHAR(50)   NOT NULL DEFAULT ''     COMMENT '联系人',
  `phone`          VARCHAR(30)   NOT NULL DEFAULT ''     COMMENT '联系电话',
  `credit_level`   VARCHAR(10)   NOT NULL DEFAULT 'B'    COMMENT '信用等级：A / B / C',
  `payment_days`   INT           NOT NULL DEFAULT 30     COMMENT '账期（天）',
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'active' COMMENT '合作状态：active 合作中 / paused 已暂停',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_supplier_code` (`code`),
  KEY `idx_supplier_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='供应商主数据表';
