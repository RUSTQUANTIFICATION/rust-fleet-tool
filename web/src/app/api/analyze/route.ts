import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const form = await req.formData();
  const image = form.get("image");
  if (!image || !(image instanceof File)) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  const fd = new FormData();
  fd.append("image", image);

  const r = await fetch(`${process.env.PY_API_BASE_URL}/analyze`, {
    method: "POST",
    body: fd
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}