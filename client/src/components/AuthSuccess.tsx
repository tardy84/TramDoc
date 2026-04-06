import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthSuccess() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    useEffect(() => {
        const token = searchParams.get('token');
        if (token) {
            localStorage.setItem('audiobook_token', token);
            // We could also fetch user info here or let App.tsx do it
            window.location.href = '/'; // Refresh to trigger App.tsx load
        } else {
            navigate('/auth');
        }
    }, [searchParams, navigate]);

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
            <div className="text-white text-xl animate-pulse">Đang đăng nhập...</div>
        </div>
    );
}
