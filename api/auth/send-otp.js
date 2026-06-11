import { Resend } from 'resend';

const rawKey = process.env.RESEND_API_KEY || 're_N1WEq15G_K8mUFL7CrcZKTR62CpSbAG9Y';
const maskedKey = rawKey ? `${rawKey.substring(0, 5)}...${rawKey.substring(rawKey.length - 4)}` : 'undefined';
const apiKeySource = process.env.RESEND_API_KEY ? "environment variable" : "hardcoded fallback";
console.log(`[Resend Config] Using Resend API Key from: ${apiKeySource} (${maskedKey})`);

const resend = new Resend(rawKey);

export default async function handler(req, res) {
    // Add CORS headers to enable mobile / WebView cross-origin requests
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        console.warn(`[send-otp] Rejected ${req.method} request`);
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { email, otp } = req.body;

    if (!email || !otp) {
        console.warn(`[send-otp] Missing parameters: email=${email}, otp=${otp}`);
        return res.status(400).json({ message: 'Missing email or otp' });
    }

    console.log(`[send-otp] Attempting to send OTP email to: ${email}`);

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
            console.error("[send-otp] Resend API reported failure:", error);
            return res.status(400).json({
                name: error.name || 'ResendError',
                message: error.message || 'Unknown Resend error occurred',
                statusCode: error.statusCode || 400,
                ...error
            });
        }

        console.log(`[send-otp] Email sent successfully. Resend ID: ${data?.id}`);
        res.status(200).json({ message: 'Email sent successfully', id: data?.id });
    } catch (err) {
        console.error("[send-otp] Serverless handler caught exception:", err);
        res.status(500).json({
            name: err.name || 'InternalServerError',
            message: err.message || 'Internal Server Error'
        });
    }
}

