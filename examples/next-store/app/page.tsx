import Buy from './buy';
export default function Shop() {
  return <main style={{ maxWidth: 600, margin: '80px auto', padding: 24 }}>
    <h1>Your existing store</h1><p>A server-priced 10 USDT order with PayKit checkout.</p><Buy />
  </main>;
}
