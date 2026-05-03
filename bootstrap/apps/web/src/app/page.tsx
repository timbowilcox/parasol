export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: '4rem',
          fontWeight: 400,
          margin: 0,
          letterSpacing: '-0.02em',
        }}
      >
        parasol
      </h1>
      <p
        style={{
          marginTop: '1.5rem',
          fontSize: '1rem',
          color: '#5a5a5a',
          maxWidth: '32rem',
        }}
      >
        AI legal copilot for in-house counsel and finance leaders across East
        Africa. Coming soon.
      </p>
    </main>
  );
}
