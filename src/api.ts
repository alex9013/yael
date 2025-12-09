import axios from 'axios';
export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
});

export function setAuth(token: string | null) {
    if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    else delete api.defaults.headers.common['Authorization'];
    
}

setAuth(localStorage.getItem('token'));

//si el token expira o es inválido, eliminarlo y redirigir al login

 api.interceptors.response.use(
    (r) => r,
    (err) => {
        if (err.response?.status === 401) {
            localStorage.removeItem('token');
            setAuth(null);
            window.location.href = '/login';
     }
        return Promise.reject(err);
 }
 );