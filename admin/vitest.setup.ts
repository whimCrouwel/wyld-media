// vitest の setupFiles から 'dotenv/config' を bare specifier のまま渡すと、
// jsdom / happy-dom 環境下では Vite が誤って親ディレクトリ(リポジトリルート)の
// node_modules を解決先にしてしまい読み込みに失敗する(admin/ 内の node_modules
// ではなく)。通常のプロジェクトファイル経由の import は正しく解決されるため、
// この小さなラッパーファイル越しに読み込むことで回避する。
import 'dotenv/config';
