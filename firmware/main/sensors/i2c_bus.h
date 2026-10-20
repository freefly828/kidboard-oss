#pragma once

namespace kidboard {

/**
 * 板载 I2C0 总线（reTerminal E1001：SDA=19 / SCL=20），PCF8563 RTC 与 SHT40 共用。
 * 首次调用时创建；失败返回 nullptr（宿主机恒为 nullptr）。返回值为 i2c_master_bus_handle_t。
 */
void* sharedI2cBus();

} // namespace kidboard
