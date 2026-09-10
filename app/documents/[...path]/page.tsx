export async function generateStaticParams(): Promise<{ path: string[] }[]> {
  // This route exists so static export builds a placeholder document entry.
  return [{ path: ["__placeholder__"] }];
}

export default function DocumentPage() {
  return null;
}
