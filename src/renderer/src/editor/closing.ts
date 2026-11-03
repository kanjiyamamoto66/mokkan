// 編集画面を閉じたあとの片付け

/** 閉じた編集画面の、まだ終わっていない保存（閉じたあとの片付けで待つ） */
export const pendingSaves = new Map<string, Promise<void>>()

/**
 * 編集画面を閉じたあとに呼ぶ。残っていた保存を待ってから、空の新規チケットなら削除する
 * （React の StrictMode は開発中に画面部品を作り直すので、削除は画面部品の片付けではなくここで行う）
 */
export async function afterClose(fileName: string, isNew: boolean): Promise<void> {
  await pendingSaves.get(fileName)
  pendingSaves.delete(fileName)
  if (isNew) await window.api.discardIfEmpty(fileName)
}
