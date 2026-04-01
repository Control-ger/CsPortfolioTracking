/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                background: 'hsl(var(--color-background))',
                foreground: 'hsl(var(--color-foreground))',
            }
        },
    },
    plugins: [],
}