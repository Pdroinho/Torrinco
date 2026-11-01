ALTER TABLE `commerce_orders` ADD COLUMN `payment_method` VARCHAR(16) NOT NULL DEFAULT 'pix', ADD COLUMN `open_card_key` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `commerce_orders_open_card_key_key` ON `commerce_orders`(`open_card_key`);
