# 東京の天気（気象庁データ）

気象庁（JMA）の公開データを利用して、**東京の今日の天気・気温・降水確率・気圧**を表示する静的Webアプリです。バックエンド不要で、ブラウザから気象庁のJSONを直接取得します。

🌐 **公開サイト: https://0x5da3.github.io/low-pressure/**

## 表示するデータ

| 項目 | データ元 |
| --- | --- |
| 天気（アイコン・文章） | 予報 `forecast/130000.json`（東京地方） |
| 降水確率（時間帯別） | 予報 `forecast/130000.json` |
| 最高/最低気温 | 予報（短期＋週間） |
| 現在の気温・気圧・湿度 | アメダス実況 `amedas/data/map/<時刻>.json`（東京 観測所 `44132`） |
| 12時間後までの気温・天気・気圧の変化（グラフ） | 気象庁 数値予報モデル（MSM/GSM）を Open-Meteo 経由で取得 |

> 時別（hourly）の気温・気圧の将来予報は気象庁の `bosai` JSON には含まれないため、気象庁の数値予報モデルを配信する [Open-Meteo](https://open-meteo.com/) の無料API（APIキー不要・CORS対応）を利用しています。グラフはバンドル不要の軽量インラインSVGで描画しています。

## 使用している気象庁エンドポイント

- 予報: `https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json`
- アメダス最新時刻: `https://www.jma.go.jp/bosai/amedas/data/latest_time.txt`
- アメダス実況: `https://www.jma.go.jp/bosai/amedas/data/map/<YYYYMMDDHHMMSS>.json`
- 天気アイコン: `https://www.jma.go.jp/bosai/forecast/img/<天気コード>.svg`

これらは CORS（`Access-Control-Allow-Origin: *`）に対応しているため、静的ホスティングからクライアントサイドで取得できます。

## ローカルで動かす

```bash
# 任意の静的サーバで配信（例）
python3 -m http.server 8000
# → http://localhost:8000
```

`file://` で直接開くと一部ブラウザで fetch が制限されるため、簡易サーバ経由を推奨します。

## GitHub Pages へのデプロイ

`main` ブランチへの push で `.github/workflows/deploy.yml` が動き、GitHub Pages に自動デプロイされます（Pages のソースを「GitHub Actions」に設定）。手動実行（workflow_dispatch）も可能です。

公開URL（例）: `https://0x5da3.github.io/low-pressure/`

## 出典

[気象庁](https://www.jma.go.jp/bosai/) の予報・アメダス実況データを利用しています。
