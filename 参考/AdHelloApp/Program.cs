using System.DirectoryServices.Protocols;
using System.Net;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => Results.Redirect("/login"));

app.MapGet("/login", () =>
{
    return Results.Content("""
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
</head>
<body>
  <h1>ログイン</h1>
  <form method="post" action="/login">
    <div>
      <label>ユーザー名</label>
      <input name="username" />
    </div>
    <div>
      <label>パスワード</label>
      <input name="password" type="password" />
    </div>
    <button type="submit">ログイン</button>
  </form>
</body>
</html>
""", "text/html; charset=utf-8");
});

app.MapPost("/login", async (HttpRequest request) =>
{
    var form = await request.ReadFormAsync();
    var username = form["username"].ToString();
    var password = form["password"].ToString();

    var domain = "DOMAIN";        // ここを実際のドメイン名に変更
    var ldapServer = "LAN-SERVER5"; // 先ほど確認したADサーバー

    try
    {
        using var connection = new LdapConnection(ldapServer);
        connection.AuthType = AuthType.Negotiate;
        connection.Credential = new NetworkCredential(username, password, domain);
        connection.Bind();

        return Results.Content("""
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
</head>
<body>
  <h1>hello</h1>
</body>
</html>
""", "text/html; charset=utf-8");
    }
    catch
    {
        return Results.Content("""
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
</head>
<body>
  <h1>ログイン失敗</h1>
  <a href="/login">戻る</a>
</body>
</html>
""", "text/html; charset=utf-8");
    }
});

app.Run();