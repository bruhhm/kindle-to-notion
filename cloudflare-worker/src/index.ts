export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_REF?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = env.GITHUB_TOKEN;
    const owner = env.GITHUB_OWNER || 'bruhhm';
    const repo = env.GITHUB_REPO || 'kindle-to-notion';
    const workflow = env.GITHUB_WORKFLOW || 'sync.yml';
    const ref = env.GITHUB_REF || 'main';

    if (!token) {
      return new Response(JSON.stringify({ error: 'GITHUB_TOKEN environment secret is not configured on Cloudflare Worker.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const githubUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

    try {
      const ghResponse = await fetch(githubUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Cloudflare-Kindle-Notion-Worker',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref })
      });

      if (!ghResponse.ok && ghResponse.status !== 204) {
        const errText = await ghResponse.text();
        return new Response(JSON.stringify({ error: 'GitHub API error', status: ghResponse.status, details: errText }), {
          status: ghResponse.status,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // If request is from browser/GET, return a clean confirmation UI
      if (request.method === 'GET') {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kindle to Notion Sync Triggered</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background-color: #f7f6f3;
      color: #37352f;
    }
    .card {
      background: #ffffff;
      padding: 2.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    h2 {
      margin-top: 0;
      color: #0f8558;
      font-size: 1.5rem;
    }
    p {
      color: #6b6b6b;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.6rem 1.2rem;
      background: #2eaadc;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Sync Triggered Successfully</h2>
    <p>Your Kindle and Goodreads reading library is now synchronizing in GitHub Actions.</p>
    <p>Your Notion databases will update in approximately 60 seconds.</p>
    <a href="javascript:window.close()" class="btn">Close Window</a>
  </div>
</body>
</html>`;
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // If POST or other, return JSON
      return new Response(JSON.stringify({ success: true, message: 'Kindle to Notion sync workflow triggered' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
