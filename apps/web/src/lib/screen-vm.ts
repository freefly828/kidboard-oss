/**
 * 墨水屏内容 VM — Web 预览页、Web/H5 看板、screen API 共用。
 * 取数与"今天 / 明日预览"判定由 @kidboard/db/screen-input 完成，renderer 生成墨水屏帧时
 * 调用同一函数，因此各端显示内容一致（D-011 / D-013）。
 */

import type { ScreenViewModel } from "@kidboard/screen-template";
import { poemOfDay } from "@kidboard/screen-template";
import { assembleViewModel } from "@kidboard/screen-template/assemble";
import { loadScreenInput } from "@kidboard/db/screen-input";

export async function loadScreenViewModel(child: {
  id: string;
  timezone: string;
  displayName: string;
  previewFrom: string | null;
  familyId: string;
}): Promise<ScreenViewModel> {
  const { plan, input } = await loadScreenInput(child);
  return assembleViewModel({
    ...input,
    poem: poemOfDay(plan.today),
  });
}
