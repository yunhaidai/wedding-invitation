// RSVP Form Backend - Cloudflare Worker with KV Storage
// Deploy to Cloudflare Workers, bind a KV namespace named "RSVP_STORE"

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Submit RSVP
    if (url.pathname === '/submit' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { name, phone, attending, guests } = data;

        // Validate required fields
        if (!name || !phone || !attending) {
          return new Response(
            JSON.stringify({ error: '缺少必填字段' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create RSVP record
        const rsvp = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          name: name.trim(),
          phone: phone.trim(),
          attending: attending, // "yes" or "no"
          guests: parseInt(guests) || 1,
        };

        // Store in KV
        const key = `rsvp:${rsvp.id}`;
        await env.RSVP_STORE.put(key, JSON.stringify(rsvp));

        // Also maintain an index for easy listing
        const indexKey = 'rsvp:index';
        let index = [];
        try {
          const existing = await env.RSVP_STORE.get(indexKey);
          index = existing ? JSON.parse(existing) : [];
        } catch (e) {
          index = [];
        }
        index.push(rsvp.id);
        await env.RSVP_STORE.put(indexKey, JSON.stringify(index));

        return new Response(
          JSON.stringify({ success: true, message: '提交成功', id: rsvp.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: '提交失败: ' + e.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Export CSV (admin endpoint - add password protection in production)
    if (url.pathname === '/export' && request.method === 'GET') {
      try {
        const indexKey = 'rsvp:index';
        const existing = await env.RSVP_STORE.get(indexKey);
        if (!existing) {
          return new Response('暂无数据', { headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        const ids = JSON.parse(existing);
        const rows = [];
        rows.push(['ID', '时间', '姓名', '电话', '是否出席', '人数']);

        for (const id of ids) {
          const record = await env.RSVP_STORE.get(`rsvp:${id}`);
          if (record) {
            const r = JSON.parse(record);
            rows.push([
              r.id,
              r.timestamp,
              r.name,
              r.phone,
              r.attending === 'yes' ? '出席' : '缺席',
              r.guests,
            ]);
          }
        }

        const csv = rows.map(row => row.join(',')).join('\n');
        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="rsvp-data.csv"',
          },
        });
      } catch (e) {
        return new Response(
          '导出失败: ' + e.message,
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } }
        );
      }
    }

    // Health check
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({ status: 'ok', service: 'RSVP Worker' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
