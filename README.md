# 東京の天気（気象庁データ）

気象庁（JMA）の数値予報モデル（MSM/GSM）をもとに、**東京の天気・気温・気圧の移り変わり（過去6時間〜12時間後）**をグラフ表示する静的Webアプリです。バックエンド不要で、ブラウザから直接データを取得します。

🌐 **公開サイト: https://0x5da3.github.io/low-pressure/**

## 表示するデータ

| グラフ | 内容 |
| --- | --- |
| 天気 | 時間帯ごとの天気（絵文字ストリップ・2時間ごと） |
| 気温の変化 | 過去6時間〜12時間後の気温（°C）の折れ線 |
| 気圧の変化 | 過去6時間〜12時間後の海面気圧（hPa）の折れ線 |

過去は点線・予報は実線で区別し、**現在時刻**を縦線と「現在」マーカーで明示します。

## データ源

- `https://api.open-meteo.com/v1/jma`（緯度経度=東京、`temperature_2m` / `weather_code` / `pressure_msl`、`past_days=1` / `forecast_days=2`）

時別（hourly）の気温・気圧の将来予報は気象庁の `bosai` 公開JSONには含まれないため、気象庁の数値予報モデル（MSM/GSM）を配信する [Open-Meteo](https://open-meteo.com/) の無料API（APIキー不要・CORS対応）を利用しています。グラフはライブラリ不要の軽量インラインSVGで描画しています。

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

[気象庁](https://www.jma.go.jp/) 数値予報モデル（MSM/GSM）・[Open-Meteo](https://open-meteo.com/) 経由のデータを利用しています。
