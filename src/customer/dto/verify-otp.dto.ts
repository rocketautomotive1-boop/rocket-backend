import { IsIn, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
    @IsString()
    @IsNotEmpty()
    destination: string;

    @IsIn(['email', 'whatsapp', 'sms'])
    channel: 'email' | 'whatsapp' | 'sms';

    @IsIn(['login', 'register'])
    purpose: 'login' | 'register';

    @IsString()
    @Length(6, 6)
    code: string;

    // Necessário só quando purpose = 'register' e o destino ainda não tem conta.
    name?: string;
}
