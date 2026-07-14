import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UnauthorizedException, BadRequestException, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerService } from './customer.service';
import { OtpService } from './otp.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { GoogleTokenDto } from './dto/google-token.dto';

// TODO: Add auth guards later. For now, open for testing or use simple Admin guard if needed.
@Controller('customers')
export class CustomerController {
    constructor(
        private readonly customerService: CustomerService,
        private readonly otpService: OtpService,
    ) { }

    @Post('login')
    async login(@Body() loginDto: LoginCustomerDto) {
        const result = await this.customerService.login(loginDto);
        if (!result) {
            throw new UnauthorizedException('Credenciais inválidas');
        }
        return result;
    }

    @Post('check-email')
    async checkEmail(@Body() dto: CheckEmailDto) {
        return this.customerService.checkEmail(dto.email);
    }

    @Post('auth/google/token')
    async googleToken(@Body() dto: GoogleTokenDto) {
        return this.customerService.loginWithGoogleIdToken(dto.idToken);
    }

    @Post('otp/send')
    async sendOtp(@Body() dto: SendOtpDto) {
        await this.otpService.send(dto.destination, dto.channel, dto.purpose);
        return { sent: true };
    }

    @Post('otp/verify')
    async verifyOtp(@Body() dto: VerifyOtpDto) {
        const isValid = await this.otpService.verify(dto.destination, dto.channel, dto.purpose, dto.code);
        if (!isValid) {
            throw new BadRequestException('Código inválido ou expirado.');
        }
        return this.customerService.loginOrRegisterViaOtp(dto.destination, dto.channel, dto.name);
    }

    @Get('auth/google')
    @UseGuards(AuthGuard('google'))
    async googleAuth(@Req() req) { }

    @Get('auth/google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Req() req, @Res() res) {
        const result = await this.customerService.validateGoogleUser(req.user);

        // Redirect to frontend with token
        // In production, use a secure cookie or a temporary code exchange.
        // For this MVP, we pass token in URL or use a client-side popup handler.
        // Let's redirect to frontend with token in query param.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/auth/callback?token=${result.access_token}`);
    }

    @Post()
    create(@Body() createCustomerDto: CreateCustomerDto) {
        return this.customerService.create(createCustomerDto);
    }

    @Get()
    findAll() {
        return this.customerService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.customerService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto) {
        return this.customerService.update(id, updateCustomerDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.customerService.remove(id);
    }
}
