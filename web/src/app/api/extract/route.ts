import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch(`${process.env.PY_API_BASE_URL}/extract`, {
    method: "POST",
    body: fd
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}