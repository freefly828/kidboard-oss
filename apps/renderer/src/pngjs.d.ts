/**
 * pngjs 的本地最小类型声明。
 *
 * 为什么不用 @types/pngjs：
 * - 本仓库只需要 sync.read 与几个字段，引入完整 @types 包属于新依赖，收益不足；
 * - pngjs 是纯 JS 包（无原生编译），版本固定在 7.0.0，interface 稳定。
 *
 * 如果未来升级 pngjs 并需要更多 API，请同步扩展本文件，而不是改用 any。
 */
declare module "pngjs" {
  export interface PngInstance {
    width: number;
    height: number;
    data: Uint8Array;
    /** 每通道位深：Chromium 截图为 8 */
    depth: number;
    /** 0=gray, 2=RGB, 4=gray+alpha, 6=RGBA */
    colorType: number;
  }

  export interface PngSync {
    read(buffer: Buffer | Uint8Array): PngInstance;
    write(png: PngInstance): Buffer;
  }

  export const PNG: {
    sync: PngSync;
    new (options?: { width?: number; height?: number }): PngInstance;
  };
}
