const { gql } = require("graphql-tag");

module.exports = gql`
  enum Gender {
    MALE
    FEMALE
    OTHER
  }
type ProfileImageUploadResponse {
  success: Boolean!
  message: String!
  url: String
  filename: String
  user: User
}

  type User {
    id: ID!
    name: String
    countryCode: String
    mobile: String
    gender: Gender
    birthDate: String
    birthTime: String
     birthPlace: String
    occupation: String
    isActive: Boolean
    isDeleted: Boolean
    createdAt: String
    updatedAt: String
    user_status: Int
    wallet: UserWallet
    stats: UserDashboardStats
      profileImage: String
  }

  type AuthPayload {
    user: User!
    accessToken: String!
    refreshToken: String!
    isNewUser: Boolean!
    hasName: Boolean!
  }
  type OtpResponse {
    message: String!
    otp: String
  }
  type UserPagination {
    data: [User!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }
  # -----------------------------------------
  # User update input for profile management (optional)
  # -----------------------------------------
  input UpdateUserInput {
    name: String
    gender: Gender
    birthDate: String
    birthTime: String
    occupation: String
      birthPlace: String
       profileImage: String
  }
  # -----------------------------------------
  # End user update input section
  # -----------------------------------------
  # -----------------------------------------
  # Astrologer Public Search Configuration

  # -----------------------------------------

  type AstrologerPricing {
    id: ID
    type: String
    price: Float
    originalPrice: Float
    offerPrice: Float
    appliedOffer: String
    commissionPercent: Float
    isActive: Boolean
  }
  type ActiveOffer {
    id: ID!
    offerName: String!
    price: Float!
    description: String
  }
  type Astrologer {
    id: ID
    profilePic: String
    name: String
    displayName: String
    experience: Int
    rating: Float
    skills: [String]
    languages: [String]
    problems: [String]
    activeOffer: ActiveOffer
    about: String
    isBusy: Boolean
    isOnline: Boolean
    isChatActive: Boolean
    isCallActive: Boolean
    isLiveActive: Boolean
    isEligibleChat: Boolean
    isEligibleCall: Boolean
    isEligibleVideo: Boolean
    isEligibleAudio: Boolean
    tags: String
    vtags: String

    pricing: [AstrologerPricing]

    reviews: [Review]
  }

  input AstrologerSearchInput {
    query: String # Search by name / skills / language
    sortField: SortField # Sorting field
    sortOrder: SortOrder # ASC or DESC
    limit: Int # Items per page
    page: Int # Page number
    type: PricingType
    category: String
  }

  enum SortField {
    EXPERIENCE
    PRICE
    RATING
  }

  enum SortOrder {
    ASC
    DESC
  }

  type AstrologerPagination {
    data: [Astrologer!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }
  #---START CODE FOR WALLET TRANSACTION-------------
  type WalletTransaction {
    id: ID!
    userWalletId: String
    astrologerWalletId: String
    rechargePackId: String
    sessionId: String

    type: String
    coins: Int
    amount: Float
    description: String

    astrologerName: String
    createdAt: String
  }

  type WalletTransactionResponse {
    data: [WalletTransaction]
    totalCount: Int
    currentPage: Int
    totalPages: Int
  }
  input WalletTransactionFilter {
    page: Int
    limit: Int
    type: [String]
    fromDate: String
    toDate: String
  }
  #----END CODE FOR WALLET TRANSACTION-------
  # -----------------------------------------
  # End Astrologer Search Section
  # -----------------------------------------
  # -----------------------------------------
  # start recharge pack section
  # -----------------------------------------
  type RechargePack {
    id: ID!
    name: String!
    description: String
    price: Float!
    coins: Int!
    talktime: Int!
    validityDays: Int!
    createdAt: String!
  }

  type RechargePackResponse {
    data: [RechargePack!]!
    totalCount: Int!
  }
  # -----------------------------------------
  # End recharge pack section
  # -----------------------------------------

  # -----------------------------------------
  # Intake Section
  # -----------------------------------------

  enum PricingType {
    CHAT
    CALL
    VIDEO
    AUDIO
    GIFT_COMMISSION
    OFFER
  }

  type CreateIntakeResponse {
    roomId: String!
    chatTime: Int!
    intakeId: String!
    message: String

    # NEW
    pricePerMin: Float
    pricingType: PricingType
    appliedOffer: String
  }

  input IntakeInput {
    astrologerId: String!
    name: String!
    countryCode: String!
    mobile: String!
    gender: Gender!
    birthDate: String!
    birthTime: String!
    occupation: String!
    birthPlace: String!
    requestType: String!
    latitude: Float
    longitude: Float
    source: String!
  }

  type Intake {
    id: ID!
    name: String!
    countryCode: String
    mobile: String!
    gender: Gender!
    birthDate: String!
    birthTime: String!
    occupation: String!
    birthPlace: String!
    requestType: String!
    chatId: String
    latitude: Float
    longitude: Float
    # OPTIONAL ADDITIONS
    pricePerMin: Float
    pricingType: PricingType
    source: String!

    createdAt: String!
  }

  #------------------------------------------
  # end intake section

  #-----------------------------------------
  # Get User by ID (for admin or internal use)
  #-----------------------------------------
  type UserBasicInfo {
    id: ID!
    name: String
    countryCode: String
    mobile: String
    gender: Gender
    birthDate: String
    birthTime: String
    occupation: String
    isActive: Boolean
    isDeleted: Boolean
    createdAt: String
    updatedAt: String
    wallet: UserWallet
  }

  #---------END------------------------------
  #-----------------------------------------
  # start session section
  #-----------------------------------------
  enum SessionType {
    CHAT
    CALL
  }

  type Session {
    id: ID!

    userId: String!
    astrologerId: String!

    type: SessionType!
    status: SessionStatus!

    ratePerMin: Int
    durationSec: Int

    coinsDeducted: Int
    coinsEarned: Int
    commission: Int

    startedAt: String
    endedAt: String

    createdAt: String
  }

  #-end session section ------------------

  #------start queue section-------------------
  type ChatQueueItem {
    roomId: String!
    userId: String!
    astrologerId: String!
    createdAt: String!
  }
  #---------End Queue Section-------------------
  #--------start get user wallet----------------
  type UserWallet {
    id: ID!
    userId: String!
    balanceCoins: Float!
    lockedCoins: Float!
    createdAt: String!
    updatedAt: String!
  }
  #---------End get user wallet----------------
  #-----------start review-------------------
  #----------- START REVIEW -------------------

  type Review {
    id: ID!

    userId: String!
    astrologerId: String!

    sessionId: String

    rating: Int!
    comment: String
    reply: String

    isFlagged: Boolean

    userName: String
    astroName: String

    createdAt: String
    updatedAt: String
  }

  input CreateReviewInput {
    astro_id: String!
    star: Int!
    comment: String
  }

  type CreateReviewResponse {
    success: Boolean!
    message: String!
    review: Review
  }

  #----------- END REVIEW -------------------
  #--------------end review-------------
  #--------------start chat history----------
  scalar JSON

  type Message {
    id: String!
    msgId: String
    roomId: String
    senderId: String
    receiverId: String
    message: String
    image: String
    sender: String
    replyTo: JSON
    sessionId: String
    createdAt: String
  }

  type ChatHistory {
    roomId: String!
    sessionId: String

    startedAt: String
    endedAt: String
    status: String

    user: User
    astrologer: Astrologer

    lastMessage: Message
  }
  #------END chat history-----
  #----start GetUser Sessions----------
  enum SessionStatus {
    REQUESTED
    ACCEPTED
    ONGOING
    COMPLETED
    CANCELLED
    FAILED
  }

 input SessionFilterInput {
  status: SessionStatus
  type: SessionType
  fromDate: String
  toDate: String
  page: Int
  limit: Int
}

  
 type ChatSession {
  id: ID

  userName: String
  astrologerName: String
  displayName: String
  astrologerImage: String

  type: SessionType

  startedAt: String
  endedAt: String

  durationSec: Int
  durationMin: Int

  ratePerMin: Int
  ratePerSecond: Float

  totalCharge: Float
  coinsEarned: Float
  commission: Float

  status: SessionStatus
}
  type UserDashboardStats {
    walletBalance: Int
    totalRecharge: Float
    totalRechargeCount: Int
    totalCalls: Int
    totalChats: Int
    totalReviews: Int
    totalFollowing: Int
    totalBookings: Int
    lastRechargeAmount: Float
    lastRechargeDate: String
  }
  type ChatSessionResponse {
    data: [ChatSession]
    totalCount: Int
    currentPage: Int
    totalPages: Int
  }

  #-----------------------ENd user sessions------------

  #--------------upload image response----------------
  scalar Upload

  type UploadResponse {
    url: String
    filename: String
  }
  #-------------------End upload image response---------

  #------------------start for get live chatmessages----
  type ChatMessage {
    msg_id: String
    sender_id: String
    room_id: String
    received_id: String
    message: String
    image: String
    sender: String
    replyTo: JSON
    time: String
  }
  #-------------------end for get live chatmessages-----------------------

  #------------------start recent intake response-----------------------
  type RecentIntakeResponse {
    success: Boolean
    message: String
    data: [Intake]
  }
  #-------------------end recent intake response-----------------------
  #------------------start code for razorpay order---------------------

  input CreateOrderInput {
    rechargePackId: String!
    coupan_code: String
  }

  type CreateOrderResponse {
    success: Boolean!
    orderId: String!
    amount: Int!
    currency: String!
  }
  #--------------------end code for razorpay order-----------------------
  #------------------start code for astrologer application---------------
  #-------START CODE FOR VIEW REMEDY IN CHAT HISTORY-----
  type SessionRemedy {
    id: ID!
    sessionId: String!
    remedyText: String!
    createdAt: String
  }

  #---------------END--------------
  enum ApplicationStatus {
    PENDING
    APPROVED
    REJECTED
  }
  enum InterviewStatus {
    PENDING
    SCHEDULED
    PASSED
    REJECTED
  }
  enum DocumentStatus {
    PENDING
    VERIFIED
    REJECTED
  }
  enum ApprovalStatus {
    PENDING
    APPROVED
    REJECTED
  }

  input CreateApplicationInput {
    name: String!
    phoneNumber: String!
    email: String
    dob: String!
    gender: String!
    languages: [String!]!
    problems: [String!]!

    skills: [String!]!
    experience: Int!
    about: String
    address: String
    pincode: String
  }
  type AstrologerApplication {
    id: ID!
    name: String
    phoneNumber: String
    email: String
    gender: String
    skills: [String]
    languages: [String]
    problems: [String]

    experience: Int
    applicationStatus: String!
    interviewStatus: String
    interviewRemarks: String
    documentStatus: DocumentStatus
    approvalStatus: ApprovalStatus

    interviewerId: String
    interviewDate: String
    interviewTime: String
    round: Int

    createdAt: String
  }
  #-------------------start code for astrologer application------------

  #------------------start code for chat history-----------------------

  input UserChatHistoryFilterInput {
    page: Int
    limit: Int

    astrologerName: String
    status: SessionStatus

    startDate: String
    endDate: String
  }

  type UserChatHistoryResponse {
    success: Boolean!
    summary: ChatHistorySummary!
    data: [UserChatHistoryItem!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }

  type ChatHistorySummary {
    totalCoinsDeducted: Float!
    totalCoinsEarned: Float!
    totalCommission: Float!
    totalRecords: Int!
  }

  type UserChatHistoryItem {
    srNo: Int

    roomId: String
    sessionId: String

    startedAt: String
    endedAt: String
    createdAt: String

    status: String

    durationSec: Int
    durationMinutes: Int

    ratePerMin: Int

    coinsDeducted: Float
    coinsEarned: Float
    commission: Float

    user: ChatUser
    astrologer: ChatAstrologer

    lastMessage: ChatMessage
    source: String
  }

  type ChatUser {
    id: String
    name: String
    mobile: String
    countryCode: String
  }

  type ChatAstrologer {
    id: String
    name: String
    profilePic: String
    experience: Int
    rating: Float
    skills: [String]
    languages: [String]
  }
  type AstrologerReview {
    id: ID!
    userId: ID
    userName: String
    rating: Int!
    comment: String
    reply: String
    createdAt: String!
  }
  type AstrologerReviewResponse {
    data: [AstrologerReview!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
    averageRating: Float!
  }
  #--------------------End code for chat history-----------------------

  #------------------start code for call history-----------------------

  input UserCallHistoryFilterInput {
    page: Int
    limit: Int

    astrologerName: String
    status: SessionStatus

    startDate: String
    endDate: String
  }

  type UserCallHistoryResponse {
    success: Boolean!
    summary: ChatHistorySummary!
    data: [UserCallHistoryItem!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }

  type UserCallHistoryItem {
    srNo: Int

    sessionId: String

    startedAt: String
    endedAt: String
    createdAt: String

    status: String

    durationSec: Int
    durationMinutes: Int

    ratePerMin: Int

    coinsDeducted: Float
    coinsEarned: Float
    commission: Float

    user: ChatUser
    astrologer: ChatAstrologer
  }

  #--------------------End code for call history-----------

  #------------------ START GIFT SECTION ------------------

  type Gift {
    id: ID!
    name: String!
    amount: Float!
    image: String
    status: String
    createdAt: String
    updatedAt: String
  }

  type GiftResponse {
    data: [Gift!]!
    totalCount: Int!
  }

  #------------------ END GIFT SECTION ------------------
  #------------------ START BANNER SECTION --------------

  type Banner {
    id: ID!
    heading: String
    subheading: String
    slug: String
    sortorder: Int
    bannerlink: String
    language: String
    imageUrl: String
    status: Boolean
    createdAt: String
    updatedAt: String
  }

  type BannerResponse {
    data: [Banner!]!
    totalCount: Int!
  }

  #------------------ END BANNER SECTION -----------------
  #------------------ START FAQ SECTION ------------------

  type Faq {
    id: ID!
    question: String!
    answer: String!
    createdAt: String
    updatedAt: String
  }

  type FaqResponse {
    data: [Faq!]!
    totalCount: Int!
  }

  #------------------ END FAQ SECTION ------------------

  #------------------ START TESTIMONIAL SECTION ------------------

  type Testimonial {
    id: ID!
    name: String!
    address: String
    content: String!
    image: String
    rating: Int
    createdAt: String
    updatedAt: String
  }

  type TestimonialResponse {
    data: [Testimonial!]!
    totalCount: Int!
  }

  #------------------ END TESTIMONIAL SECTION ------------------
  #------------------ START ABOUT PAGE SECTION ------------------
  type MentorFounder {
    name: String
    image: String
    description: String
    designation: String
  }

  type AboutPage {
    id: ID!
    pageType: String
    heroTitle: String
    heroDescription: String

    mentors: [MentorFounder]
    founders: [MentorFounder]

    metaTitle: String
    metaDescription: String
    keywords: [String]

    status: String

    createdAt: String
    updatedAt: String
  }
  #------------------ END ABOUT PAGE SECTION ------------------
  #------------------ START REMEDY SECTION ------------------
  type Remedy {
    id: ID!
    title: String!
    description: String!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  type RemedyResponse {
    data: [Remedy!]!
    totalCount: Int!
  }
  #-----------------------------------------
  #------------------START APP VERSION SECTION ------------------
  enum PlatformType {
    ANDROID
    IOS
  }

  type AppVersion {
    id: ID!
    platform: PlatformType!
    latestVersion: String
    minimumVersion: String

    forceUpdate: Boolean
    maintenanceMode: Boolean
    maintenanceMessage: String

    playStoreUrl: String
    appStoreUrl: String

    releaseNotes: String

    createdAt: String
    updatedAt: String
  }
  #--------END APP VERSION SECTION --------------------

  #------ Healing --------#
  type Category {
    id: ID!

    name: String!
    slug: String!

    image: String

    services: [Service!]
  }

  type Service {
    id: ID!

    name: String!
    slug: String!

    image: String
    description: String
    longText: String
    price: Float
    astrologerMappings: [ServiceAstrologer!]
    category: Category
  }

  #------------START free services section----------------

  type FreeService {
    id: ID!
    title: String!
    slug: String!
    href: String!
    icon: String!
    isActive: Boolean!
    order: Int!
    createdAt: String!
    updatedAt: String!
  }

  type FreeServiceResponse {
    data: [FreeService!]!
    totalCount: Int!
  }

  #------------END free services section----------------
  #-----START CODE FOR SEND GIFT TO ASTROLOGER-------------
  input SendGiftInput {
    astro_id: String!
    gift_id: String!
    giftname: String!
    giftprice: Float!
    user_name: String
    astro_name: String
    user_id: String!
  }

  type SendGiftResponse {
  success: Boolean!
  message: String!
  userBalance: Float
  astrologerBalance: Float

  giftPrice: Float
  commissionPercent: Float
  astrologerEarning: Float
  platformEarning: Float
}

  #-----END CODE FOR SEND GIFT TO ASTROLOGER---------------
  #----START code forsendgift history ----
  type GiftHistory {
    id: ID!
    userId: String!
    astrologerId: String!
    giftId: String!
    giftName: String!
    giftPrice: Float!
    createdAt: String!

    user: GiftUser
    astrologer: GiftAstrologer
  }

  type GiftUser {
    id: String!
    name: String
    mobile: String
  }
  type GiftAstrologer {
    id: String!
    name: String
    profilePic: String
  }
  #----END code for sendgift history----------------
  #------START CODE FOR FOLLOWERS AND FOLLOWING----------------
  type AstrologerFollow {
    id: ID!

    userId: ID!
    astrologerId: ID!

    user: User
    astrologer: Astrologer

    createdAt: String!
  }

  type FollowResponse {
    success: Boolean!
    message: String!
  }

  type FollowStatusResponse {
    isFollowing: Boolean!
  }

  type FollowCountResponse {
    totalFollowers: Int!
  }

  type FollowerUser {
    id: ID!
    name: String
    mobile: String
    countryCode: String
  }

  type AstrologerFollower {
    id: ID!
    userId: String!
    astrologerId: String!
    createdAt: String!
    user: FollowerUser
  }

  type AstrologerFollowersResponse {
    followers: [AstrologerFollower!]!
    total: Int!
    page: Int!
    limit: Int!
    totalPages: Int!
  }

  type FollowedAstrologersResponse {
    astrologers: [Astrologer!]!
    total: Int!
    page: Int!
    limit: Int!
    totalPages: Int!
  }
  enum PaymentStatus {
    PENDING
    SUCCESS
    FAILED
  }

  enum BookingStatus {
    PENDING
    ASSIGNED
    IN_PROGRESS
    COMPLETED
    CANCELLED
  }
  type ServiceBooking {
    id: ID!

    service: Service!

    astrologerId: String
    astrologer: Astrologer

    name: String!
    email: String!
    phone: String!

    dob: String!
    tob: String!
    pob: String!

    gender: String
    concern: String

    amount: Float

    paymentStatus: PaymentStatus!
    bookingStatus: BookingStatus!

    createdAt: String!
    updatedAt: String!
  }
  enum CouponType {
    CASHBACK
    DISCOUNT
  }

  enum CouponVisibility {
    VISIBLE
    HIDDEN
  }
  type Coupon {
    id: ID!
    code: String!
    description: String
    type: CouponType!
    visibility: CouponVisibility!
    couponCount: Int!
    applicable: String
    status: Boolean!

    percentage: Float
    flatAmount: Float
    maxDiscount: Float
    minOrderAmount: Float

    redeemLimit: Int
    usedCount: Int

    startDate: String!
    endDate: String!

    createdAt: String!
    updatedAt: String!
  }
  input CreateServiceBookingInput {
    serviceId: ID!
    astrologerId: ID
    name: String!
    email: String!
    phone: String!

    dob: String!
    tob: String!
    pob: String!

    gender: String

    concern: String
  }
  type ServiceAstrologer {
    id: ID!
    price: Float!

    astrologer: Astrologer!
  }

  #------END CODE FOR FOLLOWERS AND FOLLOWING----------------
  #------START VERIFY COUPON---
  #------END COUPON----------------------------------------
  input VerifyServiceCouponInput {
    bookingId: ID!
    couponCode: String!
  }

  type VerifyServiceCouponResponse {
    success: Boolean!
    message: String
    coupon: Coupon
    totalAmount: Float!
    discount: Float!
    cashback: Float!
    payableAmount: Float!
    gstAmount: Float
    originalAmount: Float
  }
  #-----START CODE FOR CREATE ORDER FOR HEALING SERVICES---

  type CreateHealingOrderResponse {
    success: Boolean!
    orderId: String
    bookingId: String!

    amount: Float!

    totalAmount: Float!
    walletAmount: Float!
    payableAmount: Float!

    currency: String!
  }

  input CreateHealingOrderInput {
    bookingId: ID!
    couponCode: String
    amount: Float!
  }

  type ConfirmWalletBookingResponse {
    success: Boolean!
    message: String!
    booking: ServiceBooking
  }
  type ServiceBookingPagination {
    data: [ServiceBooking!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }

  type Blog {
    id: ID!

    title: String!
    slug: String!

    language: String!

    shortDescription: String!
    content: String!

    featuredImage: String

    publishDate: String

    status: String!

    hashtags: [String!]

    metaTitle: String
    metaDescription: String
    metaKeywords: String

    schemaMarkup: String

    categories: [BlogCategory!]

    createdAt: String
    updatedAt: String
  }
  type BlogCategory {
    id: ID!
    name: String!
    slug: String!
  }

  #-----END code for healing service------------
  #--------START CODE FOR LIVE STREAMING--------
  type UpcomingLivesResponse {
    data: [LiveStream!]!
    totalCount: Int!
    currentPage: Int!
    totalPages: Int!
  }
  type SessionRemedyResponse {
    id: ID!
    remedyText: String!
    createdAt: String!
    astrologerName: String
  }

  type LiveStream {
    id: String!
    astrologerId: String!
    title: String!
    channelName: String!
    status: String!
    scheduledAt: String
    createdAt: String
    endedAt: String

    astrologer: Astrologer
  }
  enum CmsStatus {
    DRAFT
    PUBLISHED
  }
  type LiveJoinResponse {
    rtcToken: String!
    uid: Int!
    appId: String!
    channelName: String!

    chatUserId: String!
    chatToken: String!
    chatRoomId: String!
    chatAppKey: String!
  }
  type PrivacyPage {
    id: ID

    pageType: String

    title: String

    content: String

    metaTitle: String

    metaDescription: String

    keywords: [String]

    status: CmsStatus

    createdAt: String
    updatedAt: String
  }
  type RefundPolicyPage {
    id: ID

    pageType: String

    title: String

    content: String

    metaTitle: String

    metaDescription: String

    keywords: [String]

    status: CmsStatus

    createdAt: String
    updatedAt: String
  }
  type DisclaimerPage {
    id: ID

    pageType: String

    title: String

    content: String

    metaTitle: String

    metaDescription: String

    keywords: [String]

    status: CmsStatus

    createdAt: String
    updatedAt: String
  }

  #-------END CODE FOR LIVESTREAMING------------

  #-----------------START CODE FOR CALL RECORDING----
  type CallRecording {
    id: ID!
    roomId: String!
    astroId: String!
    astroName: String!
    userId: String!
    duration: Int!
    callType: String!
    recordingUrl: String!
    createdAt: String!
    updatedAt: String!
  }

  type UploadCallRecordingResponse {
    success: Boolean!
    message: String!
    recording: CallRecording
    fileUrl: String
  }
  type Skill {
    id: ID!
    name: String!
  }

  type Problem {
    id: ID!
    name: String!
  }
  type AstrologerCategory {
    id: ID!
    name: String!
    type: String!
  }

  type PaymentInvoice {
  id: ID!

  invoiceNo: String
  transactionId: String
  razorpayOrderId: String
  razorpayPaymentId: String

  amount: Float
  discount: Float
  taxableAmount: Float

  sgst: Float
  cgst: Float
  igst: Float

  sgstRate: Float
  cgstRate: Float
  igstRate: Float
  gstRate: Float

  totalTax: Float
  totalAmount: Float
  amountReceived: Float
  amountInWords: String

  userName: String
  city: String
  state: String
  pincode: String
  country: String

  placeOfSupply: String

  supplierGSTIN: String
  supplierAddress: String
  website: String
  email: String

  recipientGSTIN: String

  transactionHistoryUrl: String

  hsnSac: String
  reverseCharge: Boolean
  panNumber: String

  createdAt: String
}
  #-------------END CALL RECORDING---
  #--------SOFT DELETE ----------
  type SoftDeleteUserResponse {
  success: Boolean!
  message: String!
}
  #----------END-----------
  type Query {
   getPaymentInvoice(transactionId: ID!): PaymentInvoice
    getAstrologerCategories: [AstrologerCategory!]!
    getActiveSkills: [Skill!]!
    getActiveProblems: [Problem!]!
    getServiceBooking(bookingId: ID!): ServiceBooking
    getCoupons: [Coupon!]!
    getSessionRemedy(sessionId: ID!): SessionRemedyResponse
    getCategories: [Category!]!
    getCategory(slug: String!): Category
    getServices: [Service!]!
    getService(slug: String!): Service
    getUsersDetails(page: Int, limit: Int, search: String): UserPagination!
    getAstrologerListBySearch(
      searchInput: AstrologerSearchInput
    ): AstrologerPagination!
    getAstrologerListForUser(
      searchInput: AstrologerSearchInput
    ): AstrologerPagination!
    getRechargePacks: RechargePackResponse!
    getRechargePackById(id: ID!): RechargePack
    me: User
    getUserById(id: String!): UserBasicInfo
    getAstrologerById(id: String!): Astrologer
    getNextChatRequest(astrologerId: String!): ChatQueueItem
    skipChatRequest(astrologerId: String!): Boolean
    getUserWallet: UserWallet
    getUserProfile: User
    getUserWalletTransactions(
      filter: WalletTransactionFilter
    ): WalletTransactionResponse

    getUserChatHistory(
      filter: UserChatHistoryFilterInput
    ): UserChatHistoryResponse
    getUserDashboard: User
    getUserSessions(filter: SessionFilterInput): ChatSessionResponse
    getChatMessages(roomId: String!): [ChatMessage]
    recentIntakes: RecentIntakeResponse
    getChatMessagesBySessionId(sessionId: String!): [ChatMessage]

    getUserCallHistory(
      filter: UserCallHistoryFilterInput
    ): UserCallHistoryResponse

    getGifts: GiftResponse!

    getBanners(language: String): BannerResponse!

    getFaqs: FaqResponse!

    getTestimonials: TestimonialResponse!

    getRemedies: RemedyResponse!

    getAboutPage: AboutPage
    getPrivacyPage: PrivacyPage
    getRefundPolicyPage: RefundPolicyPage
    getDisclaimerPage: DisclaimerPage

    getAppVersion(platform: PlatformType!): AppVersion

    getFreeServices: FreeServiceResponse!

    getFreeServiceById(id: ID!): FreeService
    getGiftHistory: [GiftHistory!]!

    isFollowing(astrologerId: ID!): FollowStatusResponse!

    getAstrologerFollowersCount(astrologerId: ID!): FollowCountResponse!

    getFollowedAstrologers(
      page: Int = 1
      limit: Int = 10
    ): FollowedAstrologersResponse!

    getServiceBookings: [ServiceBooking!]!
    getMyServiceBookings(
      page: Int = 1
      limit: Int = 10
    ): ServiceBookingPagination!

    blogs: [Blog!]!

    blog(id: ID!): Blog
    blogBySlug(slug: String!): Blog

    blogCategories: [BlogCategory!]!

    blogCategory(id: ID!): BlogCategory

    getUpcomingLives(page: Int, limit: Int): UpcomingLivesResponse

    joinLive(channelName: String!): LiveJoinResponse!

    getSessionRemedies(sessionId: String!): [SessionRemedy!]!
    getAstrologerReviews(
      astrologerId: ID!
      page: Int
      limit: Int
    ): AstrologerReviewResponse!
     getSimilarAstrologers(astrologerId: ID!): [Astrologer!]!
  }

  type Mutation {
    requestOtp(countryCode: String!, mobile: String!): OtpResponse!
    authWithOtp(
      countryCode: String!
      mobile: String!
      otp: String!
      source: String!
    ): AuthPayload
    refreshToken(token: String!): AuthPayload
    logout: Boolean
    deleteUser(id: ID!): Boolean
    updateUserProfile(input: UpdateUserInput!): User!
    createIntake(input: IntakeInput!): CreateIntakeResponse!
    createReview(input: CreateReviewInput!): CreateReviewResponse!
    uploadImage(file: Upload!): UploadResponse
    createOrder(input: CreateOrderInput!): CreateOrderResponse!
    createAstrologerApplication(
      input: CreateApplicationInput!
    ): AstrologerApplication!
    sendGift(input: SendGiftInput!): SendGiftResponse!

    followAstrologer(astrologerId: ID!): FollowResponse!

    unfollowAstrologer(astrologerId: ID!): FollowResponse!

    createServiceBooking(input: CreateServiceBookingInput!): ServiceBooking!

    updateBookingAstrologer(bookingId: ID!, astrologerId: ID!): ServiceBooking!

    createHealingOrder(
      input: CreateHealingOrderInput!
    ): CreateHealingOrderResponse!

    confirmWalletBooking(
      bookingId: ID!
      astrologerId: ID!
      walletAmount: Float!
    ): ConfirmWalletBookingResponse!

    startLive(title: String!): LiveStream!

    endLive(streamId: String!): Boolean!

    uploadCallRecording(
      recording: Upload!
      roomId: String!
      astroId: String!
      astroName: String!
      userId: String!
      duration: Int!
      callType: String!
    ): UploadCallRecordingResponse!

    verifyServiceCoupon(
      input: VerifyServiceCouponInput!
    ): VerifyServiceCouponResponse!
      uploadProfileImage(
    file: Upload!
  ): ProfileImageUploadResponse!

  softDeleteUser: SoftDeleteUserResponse!
  }
`;
