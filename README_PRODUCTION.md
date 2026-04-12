# 現場導入・デプロイガイド (Render版)

このプロジェクトを実際の現場（スタッフのスマホなど）で利用するための手順書です。

## 1. 事前準備
以下の3つのキーを準備してください。

- **DATABASE_URL**: Neon PostgreSQL の接続文字列
- **GOOGLE_MAPS_API_KEY**: Google Cloud Console で取得した Geocoding APIキー
- **GMAIL_APP_PASSWORD**: Gmail の「アプリ パスワード」（16桁）
- **ADMIN_PASSWORD**: あなたが決める管理画面用のパスワード（例: `nurse1234`）

## 2. GitHub へのアップロード
このフォルダ内のファイルを自分の GitHub リポジトリにアップロードしてください。
※ `.env` ファイルはアップロード**しないで**ください。

## 3. Render でのデプロイ手順
1. **[Render](https://render.com/)** にログインします。
2. **[New+]** -> **[Web Service]** を選択します。
3. 作成した GitHub リポジトリを連携します。
4. 設定を以下のように入力します：
   - **Name**: `staff-tracker` (任意)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **[Advanced]** -> **[Add Environment Variable]** を押し、以下の変数を入力します：
   - `DATABASE_URL`: (準備したもの)
   - `GOOGLE_MAPS_API_KEY`: (準備したもの)
   - `GMAIL_USER`: あなたのGmailアドレス
   - `GMAIL_APP_PASSWORD`: (準備したもの)
   - `ADMIN_PASSWORD`: (あなたが決めたパスワード)
6. **[Create Web Service]** をクリックして完了です。

## 4. 現場での使い方
デプロイが完了すると `https://xxx.onrender.com` のようなURLが発行されます。

1. **管理用**: `https://xxx.onrender.com/AdminDashboardMockup.html` をPCで開きます。
   - 初回アクセス時にパスワードを求められます。
2. **スタッフ用**: `https://xxx.onrender.com/StaffAppMockup.html` をスタッフのスマホで開きます。
   - ブラウザの「ホーム画面に追加」をしておくと便利です。
   - **重要**: 現場では「位置情報の許可」を必ず「常に許可」または「使用中のみ」に設定してください。

---

## トラブルシューティング
- **地図が出ない**: Google APIキーが正しく設定されているか確認してください。
- **メールが届かない**: Gmailの「アプリ パスワード」が正しいか、Gmailアドレスが正しいか確認してください。
- **GPSが動かない**: Render経由（HTTPS）でアクセスしていることを確認してください。
