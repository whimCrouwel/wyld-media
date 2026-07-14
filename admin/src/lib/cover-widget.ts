import type { SupabaseClient } from '@supabase/supabase-js';
import { initImageUploadWidget, type ImageUploadWidget } from './image-upload-widget';

export type CoverWidget = ImageUploadWidget;

// 記事カバー画像ウィジェット。固定 ID(cover / cover-file / cover-crop /
// cover-apply / cover-clear / cover-status / cover-current)を配線する。
// 自由トリミング。アップロードはメディアライブラリにも登録する。
export function initCoverWidget(supabase: SupabaseClient): CoverWidget {
  return initImageUploadWidget(supabase, {
    idPrefix: 'cover',
    emptyLabel: 'カバー画像は未設定です。',
  });
}
