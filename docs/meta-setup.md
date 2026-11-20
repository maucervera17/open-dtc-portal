# Meta setup

What the portal needs from Meta, and how to get it. Meta's UI changes often; treat the menu names as a guide and check the [Marketing API docs](https://developers.facebook.com/docs/marketing-apis/).

## 1. Ad account

- Find your **numeric ad account id** in Ads Manager (the number after `act_`). Put it in `META_AD_ACCOUNT_ID` **without** the `act_` prefix.
- Any currency and time zone work: the portal reads them from the ad account (`currency`, `timezone_name`) and uses them for amounts and for "today" and report windows. Optional overrides: `REPORT_CURRENCY`, `REPORT_TIMEZONE` (see "Currency and time zone" in the README). If you change the account's currency or time zone later, the portal shows a warning: older snapshots use the old unit.

## 2. Access token

1. Create a Meta app at developers.facebook.com (type Business) and add the Marketing API.
2. In Business Settings, create a **system user** with access to the ad account and generate a token with the `ads_read` permission. A system-user token with expiry "Never" is the least maintenance; then set `META_TOKEN_EXPIRES_AT=never`.
3. If you use a short-lived or 60-day user token instead, set `META_TOKEN_EXPIRES_AT=YYYY-MM-DD`; the portal shows a renewal banner 14 days before.
4. Put the token in `META_ACCESS_TOKEN`.

The portal only **reads** from Meta.

## 3. Pixel (optional)

- Set `META_PIXEL_ID`, or leave it empty to use the first pixel of the ad account.
- For Event Match Quality, also set `META_SYSTEM_USER_TOKEN`.
- If the pixel is shared from another business and stats are denied, set `PIXEL_STATS_ENABLED=false`.

## 4. Instagram (optional)

For the **Redes** view and the social report you need an Instagram professional account linked to a Facebook Page, and a token with Instagram insights permissions. Set `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` and `INSTAGRAM_USERNAME` (all three). The collector checks that the id and username match before reading anything.

## Troubleshooting

- **"Account guard mismatch" / "Account metadata invalid"**: Meta returned a different account id, or a currency or time zone the runtime does not recognise. Check `META_AD_ACCOUNT_ID` and the token's access to that account.
- **"Configuration invalid"**: `REPORT_CURRENCY` or `REPORT_TIMEZONE` is not a valid ISO 4217 code or IANA time zone.
- **Permission errors in the status view**: the token lacks `ads_read` on that account.
- The connection status card in the app (Estado de conexiones) shows per-connection diagnostics: codes only, never secrets.
