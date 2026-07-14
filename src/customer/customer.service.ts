import { Injectable, ConflictException, NotFoundException, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { CustomerModel, CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomerService {
    private readonly logger = new Logger(CustomerService.name);
    private readonly googleClient: OAuth2Client;

    constructor(
        @InjectModel(CustomerModel.name)
        private customerModel: Model<CustomerDocument>,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) {
        this.googleClient = new OAuth2Client(this.configService.get('GOOGLE_CLIENT_ID'));
    }

    async create(createCustomerDto: CreateCustomerDto): Promise<CustomerDocument> {
        const existing = await this.customerModel.findOne({ email: createCustomerDto.email }).exec();
        if (existing) {
            throw new ConflictException('Email already registered');
        }

        const salt = await bcrypt.genSalt();
        const hashedPassword = await bcrypt.hash(createCustomerDto.password, salt);

        const customer = new this.customerModel({
            ...createCustomerDto,
            password: hashedPassword,
            isActive: true,
            addresses: []
        });

        return customer.save();
    }

    async findAll(): Promise<CustomerModel[]> {
        return this.customerModel.find().exec();
    }

    async findOne(id: string): Promise<CustomerModel> {
        let query: any = {};
        if (typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) {
            query = { _id: id };
        } else {
            // Fallback or externalId if added later
            query = { _id: id };
        }

        const customer = await this.customerModel.findOne(query).exec();
        if (!customer) {
            throw new NotFoundException(`Customer ${id} not found`);
        }
        return customer;
    }

    async findByEmail(email: string): Promise<CustomerDocument> {
        return this.customerModel.findOne({ email }).exec();
    }

    async checkEmail(email: string): Promise<{ exists: boolean; hasPassword: boolean }> {
        const customer = await this.findByEmail(email);
        return {
            exists: !!customer,
            hasPassword: !!customer?.password,
        };
    }

    async login(loginDto: LoginCustomerDto) {
        const customer = await this.findByEmail(loginDto.email);
        if (!customer) {
            return null;
        }

        if (!customer.password) {
            return null; // Handle social login users trying to pass-login
        }

        const isPasswordValid = await bcrypt.compare(loginDto.password, customer.password);
        if (!isPasswordValid) {
            return null;
        }

        const payload = {
            email: customer.email,
            sub: customer._id.toString(), // Use Mongo ID
            roles: ['customer']
        };

        return {
            access_token: this.jwtService.sign(payload),
            customer: {
                id: customer._id.toString(),
                name: customer.name,
                email: customer.email
            }
        };
    }

    async update(id: string, updateCustomerDto: UpdateCustomerDto): Promise<CustomerModel> {
        // Find first to ensure exists and get ID if legacy
        const customer = await this.findOne(id) as CustomerDocument; // findOne logic handles the lookup

        if (updateCustomerDto.password) {
            const salt = await bcrypt.genSalt();
            updateCustomerDto.password = await bcrypt.hash(updateCustomerDto.password, salt);
        }

        Object.assign(customer, updateCustomerDto);
        return customer.save();
    }

    async remove(id: string): Promise<void> {
        const customer = await this.findOne(id) as CustomerDocument;
        await this.customerModel.deleteOne({ _id: customer._id }).exec();
    }

    /**
     * Login/registro via OTP (email ou telefone) — sem senha. O código já foi validado
     * pelo chamador (OtpService.verify). Cria a conta no primeiro acesso (auto-link por
     * e-mail/telefone, mesmo padrão do Google). Marca o canal como verificado — é a única
     * forma seria de linkar telefone a uma conta existente (nunca por texto livre não provado).
     */
    async loginOrRegisterViaOtp(destination: string, channel: 'email' | 'whatsapp' | 'sms', name?: string) {
        const isEmail = channel === 'email';
        const query = isEmail ? { email: destination } : { phone: destination };

        let customer = await this.customerModel.findOne(query).exec();

        if (!customer) {
            customer = new this.customerModel({
                email: isEmail ? destination : `${destination}@phone.rocketparts.com.br`,
                phone: isEmail ? undefined : destination,
                name: name || 'Cliente Rocket',
                isActive: true,
                addresses: [],
            });
        }

        if (isEmail) {
            customer.emailVerified = true;
        } else {
            customer.phoneVerified = true;
            if (!customer.phone) customer.phone = destination;
        }
        await customer.save();

        const payload = {
            email: customer.email,
            sub: customer._id.toString(),
            roles: ['customer'],
        };

        return {
            access_token: this.jwtService.sign(payload),
            customer: {
                id: customer._id.toString(),
                name: customer.name,
                email: customer.email,
                avatar: customer.avatar,
            },
        };
    }

    async loginWithGoogleIdToken(idToken: string) {
        let payload;
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: this.configService.get('GOOGLE_CLIENT_ID'),
            });
            payload = ticket.getPayload();
        } catch {
            throw new UnauthorizedException('Token do Google inválido ou expirado');
        }

        if (!payload?.email) {
            throw new UnauthorizedException('Token do Google inválido ou expirado');
        }

        const [firstName, ...rest] = (payload.name || '').split(' ');
        return this.validateGoogleUser({
            email: payload.email,
            firstName: firstName || payload.email,
            lastName: rest.join(' '),
            picture: payload.picture,
            googleId: payload.sub,
        });
    }

    async validateGoogleUser(googleUser: any) {
        let customer = await this.customerModel.findOne({ email: googleUser.email }).exec();

        if (customer) {
            // Update existing user with Google ID if link strategy is desired,
            // or just return user if we trust email matching.
            let changed = false;
            if (!customer.googleId) {
                customer.googleId = googleUser.googleId;
                if (!customer.avatar && googleUser.picture) {
                    customer.avatar = googleUser.picture;
                }
                changed = true;
            }
            if (!customer.emailVerified) {
                customer.emailVerified = true; // Google já garante a posse do e-mail
                changed = true;
            }
            if (changed) await customer.save();
        } else {
            // Create new user
            customer = new this.customerModel({
                email: googleUser.email,
                name: `${googleUser.firstName} ${googleUser.lastName}`,
                googleId: googleUser.googleId,
                avatar: googleUser.picture,
                emailVerified: true,
                isActive: true,
                addresses: []
            });
            await customer.save();
        }

        const payload = {
            email: customer.email,
            sub: customer._id.toString(),
            roles: ['customer']
        };

        return {
            access_token: this.jwtService.sign(payload),
            customer: {
                id: customer._id.toString(),
                name: customer.name,
                email: customer.email,
                avatar: customer.avatar
            }
        };
    }
}
