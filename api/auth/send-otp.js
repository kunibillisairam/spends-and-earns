import { Resend } from 'resend';

// NOTE: Request a free API Key from resend.com and add it to your environment variables
const resend = new Resend(process.env.RESEND_API_KEY || 're_your_api_key');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: 'Missing email or otp' });
    }

    try {
        const { data, error } = await resend.emails.send({
            from: 'Spends & Earns <onboarding@resend.dev>', // You can customize this later with your own domain
            to: [email],
            subject: 'Your Password Reset OTP',
            html: `
                <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4f46e5; text-align: center;">Spends & Earns</h2>
                    <p>Hello,</p>
                    <p>You requested to reset your password. Use the verification code below to proceed:</p>
                    <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: 800; letter-spacing: 5px; color: #1e293b; border-radius: 12px; margin: 20px 0;">
                        ${otp}
                    </div>
                    <p style="font-size: 13px; color: #6b7280; text-align: center;">This code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
                </div>
            `,
        });

        if (error) {
            console.error("Resend Error:", error);
            return res.status(400).json(error);
        }

        res.status(200).json({ message: 'Email sent successfully', id: data.id });
    } catch (err) {
        console.error("API Error:", err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}
