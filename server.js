/**
 * Active Directory への LDAP シンプルバインドで認証し、成功後にディレクトリ検索で氏名を取得して返します。
 *
 * 環境変数（参考アプリの Program.cs に合わせた既定値あり）:
 *   LDAP_URL           … 例: ldap://LAN-SERVER5:389 または ldaps://dc.example.com:636
 *   LDAP_BASE_DN       … 検索のベース DN。未設定時は AD_UPN_SUFFIX から DC=… を自動生成
 *   AD_BIND_FORMAT     … upn（既定）| downlevel
 *   AD_UPN_SUFFIX      … upn 時の UPN 右側。例: corp.local → username@corp.local
 *   AD_NETBIOS_DOMAIN  … downlevel 時の NetBIOS 名。例: DOMAIN → DOMAIN\username
 *
 * WSL からドメインコントローラに TCP で届くこと（名前解決・ファイアウォール）が必要です。
 */

const path = require("path");
const express = require("express");
const ldap = require("ldapjs");

const PORT = Number(process.env.PORT) || 3000;
const LDAP_URL = process.env.LDAP_URL || "ldap://LAN-SERVER5:389";
const LDAP_BASE_DN = process.env.LDAP_BASE_DN || "";
const AD_BIND_FORMAT = (process.env.AD_BIND_FORMAT || "upn").toLowerCase();
const AD_UPN_SUFFIX = process.env.AD_UPN_SUFFIX || "domain.local";
const AD_NETBIOS_DOMAIN = process.env.AD_NETBIOS_DOMAIN || "DOMAIN";

/** ログイン入力（短名または UPN）からバインド識別子を組み立てる */
function buildBindIdentity(trimmedUsername) {
  const at = trimmedUsername.indexOf("@");
  const loginAccount = at >= 0 ? trimmedUsername.slice(0, at) : trimmedUsername;
  if (AD_BIND_FORMAT === "downlevel") {
    return `${AD_NETBIOS_DOMAIN}\\${loginAccount}`;
  }
  if (at >= 0) {
    return trimmedUsername;
  }
  return `${loginAccount}@${AD_UPN_SUFFIX}`;
}

/** DNS 名 domain.local → DC=domain,DC=local */
function dnsSuffixToBaseDn(suffix) {
  return suffix
    .split(".")
    .filter(Boolean)
    .map((label) => `DC=${label.replace(/\\/g, "\\\\").replace(/,/g, "\\,")}`)
    .join(",");
}

function escapeLdapFilterValue(value) {
  return String(value).replace(/[\x00*()\\]/g, (ch) => {
    const hex = Buffer.from(ch, "utf8").toString("hex");
    return hex.match(/.{2}/g).map((b) => `\\${b}`).join("");
  });
}

function firstAttributeValue(entry, ...typeNames) {
  const want = new Set(typeNames.map((t) => t.toLowerCase()));
  for (const attr of entry.attributes || []) {
    const t = String(attr.type || "").toLowerCase();
    if (want.has(t) && Array.isArray(attr.values) && attr.values.length > 0) {
      const v = attr.values[0];
      if (v != null && String(v).length > 0) {
        return String(v);
      }
    }
  }
  return null;
}

/** Windows に近い表示: displayName → cn → givenName + sn */
function pickDisplayName(entry) {
  if (!entry) {
    return null;
  }
  const displayName = firstAttributeValue(entry, "displayName");
  if (displayName) {
    return displayName;
  }
  const cn = firstAttributeValue(entry, "cn");
  if (cn) {
    return cn;
  }
  const givenName = firstAttributeValue(entry, "givenName");
  const sn = firstAttributeValue(entry, "sn");
  const parts = [givenName, sn].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * バインド成功後、ユーザー オブジェクトを検索して氏名を読む。
 * @returns {{ ok: true, username: string, displayName: string | null } | { ok: false }}
 */
function authenticateAndFetchProfile(trimmedUsername, password) {
  const identity = buildBindIdentity(trimmedUsername);
  const at = trimmedUsername.indexOf("@");
  const loginAccount = at >= 0 ? trimmedUsername.slice(0, at) : trimmedUsername;
  const upnForFilter = at >= 0
    ? trimmedUsername
    : `${loginAccount}@${AD_UPN_SUFFIX}`;
  const baseDn = LDAP_BASE_DN || dnsSuffixToBaseDn(AD_UPN_SUFFIX);

  const filter = `(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=${escapeLdapFilterValue(
    loginAccount
  )})(userPrincipalName=${escapeLdapFilterValue(upnForFilter)})))`;

  return new Promise((resolve) => {
    const client = ldap.createClient({
      url: LDAP_URL,
      timeout: 15000,
      connectTimeout: 15000,
    });

    const finish = (result) => {
      try {
        client.unbind();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    client.on("error", () => finish({ ok: false }));

    client.bind(identity, password, (bindErr) => {
      if (bindErr) {
        finish({ ok: false });
        return;
      }

      const opts = {
        filter,
        scope: "sub",
        sizeLimit: 3,
        attributes: ["displayName", "cn", "givenName", "sn"],
      };

      client.search(baseDn, opts, (searchErr, res) => {
        if (searchErr || !res) {
          finish({ ok: true, username: trimmedUsername, displayName: null });
          return;
        }

        let firstEntry = null;

        res.on("searchEntry", (entry) => {
          if (!firstEntry) {
            firstEntry = entry;
          }
        });

        res.on("error", () => {
          /* TCP 等; end でも処理 */
        });

        res.on("end", () => {
          const displayName = pickDisplayName(firstEntry);
          finish({ ok: true, username: trimmedUsername, displayName });
        });
      });
    });
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!username || !password) {
    res.status(400).json({ ok: false, message: "ユーザー名とパスワードを入力してください。" });
    return;
  }

  const result = await authenticateAndFetchProfile(username, password);
  if (!result.ok) {
    res.status(401).json({ ok: false, message: "ログインに失敗しました。" });
    return;
  }

  res.json({
    ok: true,
    username: result.username,
    displayName: result.displayName,
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  const base = LDAP_BASE_DN || `(from AD_UPN_SUFFIX → ${dnsSuffixToBaseDn(AD_UPN_SUFFIX)})`;
  console.log(
    `http://127.0.0.1:${PORT}  (LDAP_URL=${LDAP_URL}, LDAP_BASE_DN=${base}, AD_BIND_FORMAT=${AD_BIND_FORMAT}, ` +
      (AD_BIND_FORMAT === "downlevel"
        ? `AD_NETBIOS_DOMAIN=${AD_NETBIOS_DOMAIN})`
        : `AD_UPN_SUFFIX=${AD_UPN_SUFFIX})`)
  );
});
