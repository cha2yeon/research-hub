# Research Hub

## 실행

```bash
npm install
npm run dev
```

## 공유 보고서(Supabase) 설정

1. Supabase SQL Editor에서 [`supabase/shared_reports.sql`](./supabase/shared_reports.sql)을 실행합니다.
2. `.env.example`을 복사해 `.env.local`을 만들고 아래 값을 설정합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SHARED_REPORT_ADMIN_PASSWORD=your-admin-password
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버 API에서만 사용되며 브라우저에 노출하지 않습니다.
Vercel에는 위 세 변수를 Production, Preview, Development 환경에 각각 등록하세요.
