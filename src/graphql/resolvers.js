const prisma = require("../config/prisma");
const redis = require("../config/redis");
const cookie = require("cookie");
const {
  sendOTPService,
  verifyOTPService,
  refreshTokenService,
} = require("../services/authService");
const { connectMongo, getDb } = require("../config/mongo");
const { v4: uuidv4 } = require("uuid");
const GraphQLJSON = require("graphql-type-json");
const path = require("path");
const fs = require("fs");
const { GraphQLUpload } = require("graphql-upload");
const { type } = require("os");
const Razorpay = require("razorpay");
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const {
  generateRtcToken,
  createAgoraChatUser,
  generateChatToken,
} = require("../utils/agoraToken");
// Helper to log events in MongoDB
async function logEvent({ userId, action, details }) {
  try {
    const db = await connectMongo();
    const collection = db.collection("userAuthLogs");
    await collection.insertOne({
      userId: userId || null,
      action,
      details: details || {},
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("Failed to log event:", error.message);
  }
}

module.exports = {
  JSON: GraphQLJSON,
  Upload: GraphQLUpload,
  Query: {
    getUsersDetails: async (
      _,
      { page = 1, limit = 10, search = "" },
      context,
    ) => {
      try {
        const skip = (page - 1) * limit;

        const whereCondition = search
          ? {
              OR: [
                { mobile: { contains: search, mode: "insensitive" } },
                { countryCode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {};

        const [users, totalCount] = await Promise.all([
          prisma.user.findMany({
            where: whereCondition,
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
          }),
          prisma.user.count({ where: whereCondition }),
        ]);

        return {
          data: users,
          totalCount,
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        throw new Error(error.message || "Failed to fetch users");
      }
    },
    getUserWallet: async (_, __, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const wallet = await prisma.userWallet.findUnique({
          where: {
            userId: context.user.id,
          },
        });

        if (!wallet) {
          throw new Error("Wallet not found");
        }
        return wallet;
      } catch (error) {
        throw new Error(error.message || "Failed to fetch wallet");
      }
    },
    getUserProfile: async (_, __, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized. Please login.");
        }

        const user = await prisma.user.findUnique({
          where: { id: context.user.id },
          select: {
            id: true,
            name: true,
            mobile: true,
            countryCode: true,
            gender: true,
            birthDate: true,
            birthTime: true,
            occupation: true,
          },
        });

        if (!user) {
          throw new Error("User not found");
        }

        return user;
      } catch (error) {
        throw new Error(error.message || "Failed to fetch user profile");
      }
    },
    getUserDashboard: async (_, __, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        const [
          user,
          totalCalls,
          totalChats,
          totalReviews,
          totalFollowing,
          totalBookings,
        ] = await Promise.all([
          prisma.user.findUnique({
            where: {
              id: userId,
            },

            include: {
              wallet: true,

              payments: {
                where: {
                  status: "SUCCESS",
                },

                orderBy: {
                  createdAt: "desc",
                },
              },
            },
          }),

          prisma.session.count({
            where: {
              userId,
              type: "CALL",
            },
          }),

          prisma.session.count({
            where: {
              userId,
              type: "CHAT",
            },
          }),

          prisma.review.count({
            where: {
              userId,
            },
          }),

          prisma.astrologerFollow.count({
            where: {
              userId,
            },
          }),

          prisma.serviceBooking.count({
            where: {
              userId,
            },
          }),
        ]);

        if (!user) {
          throw new Error("User not found");
        }

        const totalRecharge = user.payments.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0,
        );

        const lastRecharge = user.payments[0];

        return {
          ...user,

          stats: {
            walletBalance: user.wallet?.balanceCoins || 0,

            totalRecharge,

            totalRechargeCount: user.payments.length,

            totalCalls,

            totalChats,

            totalReviews,

            totalFollowing,

            totalBookings,

            lastRechargeAmount: lastRecharge?.amount || 0,

            lastRechargeDate: lastRecharge?.createdAt?.toISOString() || null,
          },
        };
      } catch (err) {
        throw new Error(err.message);
      }
    },
    getAstrologerReviews: async (
      _,
      { astrologerId, page = 1, limit = 10 },
      context,
    ) => {
      try {
        const safePage = Math.max(page, 1);
        const safeLimit = Math.min(limit, 20);

        const skip = (safePage - 1) * safeLimit;

        const where = {
          astrologerId,
          isFlagged: false,
        };

        const [reviews, totalCount, aggregate] = await Promise.all([
          prisma.review.findMany({
            where,

            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },

            orderBy: {
              createdAt: "desc",
            },

            skip,
            take: safeLimit,
          }),

          prisma.review.count({
            where,
          }),

          prisma.review.aggregate({
            where,

            _avg: {
              rating: true,
            },
          }),
        ]);

        return {
          data: reviews.map((review) => ({
            id: review.id,
            userId: review.user?.id,
            userName: review.user?.name || review.userName,
            rating: review.rating,
            comment: review.comment,
            reply: review.reply,
            createdAt: review.createdAt,
          })),

          totalCount,

          currentPage: safePage,

          totalPages: Math.ceil(totalCount / safeLimit),

          averageRating: aggregate?._avg?.rating ?? 0,
        };
      } catch (error) {
        console.error(error);
        throw new Error(error.message);
      }
    },
    getUserWalletTransactions: async (_, { filter }, context) => {
      try {
        if (!context.user) throw new Error("Unauthorized");

        const { page = 1, limit = 10, type, fromDate, toDate } = filter || {};

        const skip = (page - 1) * limit;

        const wallet = await prisma.userWallet.findUnique({
          where: { userId: context.user.id },
        });

        if (!wallet) throw new Error("Wallet not found");

        const where = {
          userWalletId: wallet.id,

          // HANDLE MULTIPLE TYPES
          ...(type && type.length > 0
            ? {
                type: {
                  in: type, // ["DEBIT", "CREDIT"]
                },
              }
            : {}),

          ...(fromDate || toDate
            ? {
                createdAt: {
                  ...(fromDate && { gte: new Date(fromDate) }),
                  ...(toDate && { lte: new Date(toDate) }),
                },
              }
            : {}),
        };

        const [transactions, totalCount] = await Promise.all([
          prisma.walletTransaction.findMany({
            where,
            include: {
              session: {
                include: {
                  astrologer: {
                    select: { name: true },
                  },
                },
              },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),

          prisma.walletTransaction.count({ where }),
        ]);

        const formatted = transactions.map((t) => ({
          id: t.id,
          userWalletId: t.userWalletId,
          astrologerWalletId: t.astrologerWalletId,
          rechargePackId: t.rechargePackId,
          sessionId: t.sessionId,

          type: t.type,
          coins: t.coins,
          amount: t.amount,
          description: t.description,

          astrologerName:
            t.type === "DEBIT" ? t.session?.astrologer?.name || "" : "",

          createdAt: t.createdAt,
        }));

        return {
          data: formatted,
          totalCount,
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error("getUserWalletTransactions error:", error);
        throw new Error(error.message);
      }
    },
    //---this api call without authentication as it is used in public search page
    getAstrologerListBySearch: async (_, { searchInput }) => {
      try {
        const {
          query,
          sortField,
          category,
          sortOrder,
          limit = 10,
          page = 1,
          type,
        } = searchInput || {};

        const skip = (page - 1) * limit;

        let orderBy = { createdAt: "desc" };

        if (sortField) {
          const sortMap = {
            EXPERIENCE: "experience",
            RATING: "rating",
          };

          if (sortMap[sortField]) {
            orderBy = {
              [sortMap[sortField]]: sortOrder === "ASC" ? "asc" : "desc",
            };
          }
        }

        const where = {
          ...(query && {
            OR: [
              {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
              {
                skills: {
                  has: query,
                },
              },
              {
                languages: {
                  has: query,
                },
              },
            ],
          }),
        };

        const [astrologers, totalCount] = await Promise.all([
          prisma.astrologer.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            include: {
              pricing: {
                where: {
                  isActive: true,
                  ...(type && { type }),
                },
              },
            },
          }),

          prisma.astrologer.count({ where }),
        ]);

        const astrologerIds = astrologers.map((a) => a.id);

        const activeOffers = await prisma.astrologerOffer.findMany({
          where: {
            astrologerId: {
              in: astrologerIds,
            },
            isActive: true,
          },
          include: {
            offer: true,
          },
        });

        const offerMap = {};

        activeOffers.forEach((item) => {
          offerMap[item.astrologerId] = item.offer;
        });

        const data = astrologers.map((astro) => {
          const specialOffer = offerMap[astro.id];

          return {
            id: astro.id,
            profilePic: astro.profilePic,
            name: astro.name,
            experience: astro.experience,
            rating: astro.rating,
            skills: astro.skills,
            languages: astro.languages,
            isBusy: astro.isBusy,
            isOnline: astro.isOnline,
            isChatActive: astro.isChatActive,
            isCallActive: astro.isCallActive,
            isLiveActive: astro.isLiveActive,
            isEligibleChat: astro.isEligibleChat,
            isEligibleCall: astro.isEligibleCall,
            isEligibleVideo: astro.isEligibleVideo,
            isEligibleAudio: astro.isEligibleAudio,
            activeOffer: specialOffer
              ? {
                  id: specialOffer.id,
                  offerName: specialOffer.offerName,
                  price: specialOffer.price,
                  description: specialOffer.description,
                }
              : null,

            pricing: astro.pricing.map((p) => ({
              type: p.type,

              price: specialOffer ? specialOffer.price : p.price,

              originalPrice: p.price,

              commissionPercent: p.commissionPercent,

              isActive: p.isActive,
            })),
          };
        });

        return {
          data,
          totalCount,
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error(error);
        throw new Error(error.message);
      }
    },

    //-----this api call for with auth--
    getAstrologerListForUser: async (_, { searchInput }, context) => {
      const requestId = `ASTRO-LIST-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 8)}`;

      const startedAt = Date.now();

      console.log("\n======================================================");
      console.log(`🚀 ${requestId} getAstrologerListForUser START`);
      console.log("======================================================");

      try {
        // =====================================================
        // STEP 1: AUTH
        // =====================================================
        console.log(`\n[${requestId}] STEP 1: Checking authentication`);

        if (!context?.user) {
          console.error(`[${requestId}] ❌ Unauthorized`);
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        console.log(`[${requestId}] ✅ User authenticated`);
        console.log(`[${requestId}] userId:`, userId);

        // =====================================================
        // STEP 2: INPUT
        // =====================================================
        console.log(`\n[${requestId}] STEP 2: Processing searchInput`);

        console.log(
          `[${requestId}] searchInput:`,
          JSON.stringify(searchInput || {}, null, 2),
        );

        const { query, sortField, sortOrder, category, type } =
          searchInput || {};

        // =====================================================
        // STEP 3: PAGINATION
        // =====================================================
        const pageNumber = Math.max(1, Number(searchInput?.page) || 1);

        const limitNumber = Math.min(
          100,
          Math.max(1, Number(searchInput?.limit) || 10),
        );

        const skip = (pageNumber - 1) * limitNumber;

        console.log(`\n[${requestId}] STEP 3: Pagination`);

        console.log(`[${requestId}] Pagination:`, {
          pageNumber,
          limitNumber,
          skip,
        });

        // =====================================================
        // STEP 4: ORDER BY
        // =====================================================
        console.log(`\n[${requestId}] STEP 4: Building orderBy`);

        let orderBy = {
          createdAt: "desc",
        };

        if (sortField) {
          const sortMap = {
            EXPERIENCE: "experience",
            RATING: "rating",
          };

          const field = sortMap[String(sortField).toUpperCase()];

          if (field) {
            orderBy = {
              [field]:
                String(sortOrder).toUpperCase() === "ASC" ? "asc" : "desc",
            };
          }
        }

        console.log(
          `[${requestId}] orderBy:`,
          JSON.stringify(orderBy, null, 2),
        );

        // =====================================================
        // STEP 5: WHERE
        // =====================================================
        console.log(`\n[${requestId}] STEP 5: Building WHERE`);

        const AND = [];

        // -----------------------------------------------------
        // SEARCH QUERY
        // -----------------------------------------------------
        if (query && String(query).trim()) {
          const searchQuery = String(query).trim();

          AND.push({
            OR: [
              {
                name: {
                  contains: searchQuery,
                  mode: "insensitive",
                },
              },
              {
                skills: {
                  has: searchQuery,
                },
              },
              {
                problems: {
                  has: searchQuery,
                },
              },
              {
                languages: {
                  has: searchQuery,
                },
              },
            ],
          });
        }

        // -----------------------------------------------------
        // CATEGORY
        // -----------------------------------------------------
        if (category && String(category).toLowerCase() !== "all") {
          AND.push({
            OR: [
              {
                skills: {
                  has: category,
                },
              },
              {
                problems: {
                  has: category,
                },
              },
            ],
          });
        }

        const where =
          AND.length > 0
            ? {
                AND,
              }
            : {};

        console.log(
          `[${requestId}] FINAL WHERE:`,
          JSON.stringify(where, null, 2),
        );

        // =====================================================
        // STEP 6: COUNT
        // =====================================================
        console.log(`\n[${requestId}] STEP 6: BEFORE astrologer.count()`);

        const countStart = Date.now();

        const totalCount = await prisma.astrologer.count({
          where,
        });

        console.log(`[${requestId}] ✅ astrologer.count() SUCCESS`);

        console.log(`[${requestId}] totalCount:`, totalCount);

        console.log(
          `[${requestId}] count duration:`,
          Date.now() - countStart,
          "ms",
        );

        // =====================================================
        // STEP 7: ASTROLOGER FIND MANY
        // =====================================================
        console.log(`\n[${requestId}] STEP 7: BEFORE astrologer.findMany()`);

        const findStart = Date.now();

        const astrologers = await prisma.astrologer.findMany({
          where,

          orderBy,

          skip,

          take: limitNumber,

          include: {
            pricing: {
              where: {
                isActive: true,

                ...(type
                  ? {
                      type,
                    }
                  : {}),
              },
            },
          },
        });

        console.log(`[${requestId}] ✅ astrologer.findMany() SUCCESS`);

        console.log(`[${requestId}] Astrologers count:`, astrologers.length);

        console.log(
          `[${requestId}] findMany duration:`,
          Date.now() - findStart,
          "ms",
        );

        // =====================================================
        // STEP 8: ASTROLOGER IDS
        // =====================================================
        console.log(`\n[${requestId}] STEP 8: Building astrologerIds`);

        const astrologerIds = astrologers.map((astro) => astro.id);

        console.log(
          `[${requestId}] astrologerIds count:`,
          astrologerIds.length,
        );

        // =====================================================
        // STEP 9: PRICING CONFIG
        // =====================================================
        console.log(
          `\n[${requestId}] STEP 9: BEFORE pricingConfig.findFirst()`,
        );

        const pricingConfig = await prisma.pricingConfig.findFirst();

        console.log(`[${requestId}] ✅ pricingConfig.findFirst() SUCCESS`);

        console.log(`[${requestId}] pricingConfig exists:`, !!pricingConfig);

        // =====================================================
        // STEP 10: USER OFFER USAGE
        // =====================================================
        console.log(
          `\n[${requestId}] STEP 10: BEFORE userOfferUsage.findUnique()`,
        );

        const usage = await prisma.userOfferUsage.findUnique({
          where: {
            userId,
          },
        });

        console.log(`[${requestId}] ✅ userOfferUsage.findUnique() SUCCESS`);

        console.log(`[${requestId}] usage:`, usage);

        // =====================================================
        // STEP 11: ASTROLOGER OFFERS
        // =====================================================
        let activeOffers = [];

        if (astrologerIds.length > 0) {
          console.log(
            `\n[${requestId}] STEP 11: BEFORE astrologerOffer.findMany()`,
          );

          const offerStart = Date.now();

          activeOffers = await prisma.astrologerOffer.findMany({
            where: {
              astrologerId: {
                in: astrologerIds,
              },

              isActive: true,
            },

            include: {
              offer: true,
            },
          });

          console.log(`[${requestId}] ✅ astrologerOffer.findMany() SUCCESS`);

          console.log(
            `[${requestId}] Active offers count:`,
            activeOffers.length,
          );

          console.log(
            `[${requestId}] Offer query duration:`,
            Date.now() - offerStart,
            "ms",
          );
        } else {
          console.log(
            `[${requestId}] No astrologers found, skipping offer query`,
          );
        }

        // =====================================================
        // STEP 12: OFFER MAP
        // =====================================================
        console.log(`\n[${requestId}] STEP 12: Building offerMap`);

        const offerMap = new Map();

        for (const item of activeOffers) {
          if (!offerMap.has(item.astrologerId)) {
            offerMap.set(item.astrologerId, item.offer);
          }
        }

        console.log(`[${requestId}] offerMap size:`, offerMap.size);

        // =====================================================
        // STEP 13: MAP ASTROLOGERS
        // =====================================================
        console.log(`\n[${requestId}] STEP 13: Mapping astrologers`);

        const data = astrologers.map((astro, index) => {
          console.log(
            `[${requestId}] Mapping astrologer ${
              index + 1
            }/${astrologers.length}`,
          );

          console.log(`[${requestId}] Astrologer:`, {
            id: astro.id,
            name: astro.name,
          });

          try {
            const specialOffer = offerMap.get(astro.id);

            const pricing = Array.isArray(astro.pricing)
              ? astro.pricing.map((p) => {
                  let finalPrice = p.price;

                  let appliedOffer = null;

                  // =================================================
                  // 1. SPECIAL OFFER
                  // =================================================
                  if (specialOffer) {
                    finalPrice = specialOffer.price;

                    appliedOffer = specialOffer.offerName;
                  }

                  // =================================================
                  // 2. FIRST OFFER
                  // =================================================
                  else if (
                    pricingConfig?.isFirstOfferEnabled &&
                    !usage?.usedFirst
                  ) {
                    finalPrice =
                      p.type === "CHAT"
                        ? pricingConfig.firstChatPrice
                        : pricingConfig.firstCallPrice;

                    appliedOffer = "FIRST_TIME_OFFER";
                  }

                  // =================================================
                  // 3. SECOND OFFER
                  // =================================================
                  else if (
                    pricingConfig?.isSecondOfferEnabled &&
                    usage?.usedFirst &&
                    !usage?.usedSecond
                  ) {
                    finalPrice =
                      p.type === "CHAT"
                        ? pricingConfig.secondChatPrice
                        : pricingConfig.secondCallPrice;

                    appliedOffer = "SECOND_TIME_OFFER";
                  }

                  // =================================================
                  // 4. GLOBAL OFFER
                  // =================================================
                  else if (pricingConfig?.isGlobalOfferEnabled) {
                    finalPrice =
                      p.type === "CHAT"
                        ? pricingConfig.globalChatPrice
                        : pricingConfig.globalCallPrice;

                    appliedOffer = "GLOBAL_OFFER";
                  }

                  return {
                    type: p.type,

                    price: finalPrice,

                    originalPrice: p.price,

                    offerPrice: p.offerPrice ?? null,

                    appliedOffer,

                    commissionPercent: p.commissionPercent,

                    isActive: p.isActive,
                  };
                })
              : [];

            return {
              id: astro.id,

              profilePic: astro.profilePic,

              name: astro.name,
              tags: astro.tags,

              displayName: astro.displayName,

              experience: astro.experience,

              rating: astro.rating,

              skills: astro.skills,

              problems: astro.problems,

              languages: astro.languages,

              isBusy: astro.isBusy,

              isOnline: astro.isOnline,

              isChatActive: astro.isChatActive,

              isCallActive: astro.isCallActive,

              isLiveActive: astro.isLiveActive,

              activeOffer: specialOffer
                ? {
                    id: specialOffer.id,

                    offerName: specialOffer.offerName,

                    price: specialOffer.price,

                    description: specialOffer.description,
                  }
                : null,

              pricing,
            };
          } catch (mapError) {
            console.error(
              `[${requestId}] ❌ ERROR mapping astrologer ${astro.id}`,
            );

            console.error(`[${requestId}] Mapping error:`, mapError);

            throw mapError;
          }
        });

        // =====================================================
        // STEP 14: RESPONSE
        // =====================================================
        console.log(`\n[${requestId}] STEP 14: Preparing response`);

        const totalPages = Math.ceil(totalCount / limitNumber);

        const response = {
          data,

          totalCount,

          currentPage: pageNumber,

          totalPages,
        };

        console.log(`[${requestId}] Response:`, {
          dataCount: data.length,

          totalCount,

          currentPage: pageNumber,

          totalPages,
        });

        console.log("\n======================================================");

        console.log(`🎉 ${requestId} getAstrologerListForUser SUCCESS`);

        console.log(
          `[${requestId}] Total duration:`,
          Date.now() - startedAt,
          "ms",
        );

        console.log("======================================================");

        return response;
      } catch (error) {
        // =====================================================
        // ERROR
        // =====================================================
        console.error(
          "\n======================================================",
        );

        console.error(`🔥 ${requestId} getAstrologerListForUser ERROR`);

        console.error("======================================================");

        console.error(`[${requestId}] Error name:`, error?.name);

        console.error(`[${requestId}] Error message:`, error?.message);

        console.error(`[${requestId}] Error code:`, error?.code);

        console.error(`[${requestId}] Error meta:`, error?.meta);

        console.error(`[${requestId}] Error stack:`, error?.stack);

        console.error(
          `[${requestId}] Total duration:`,
          Date.now() - startedAt,
          "ms",
        );

        console.error("======================================================");

        throw error;
      }
    },

    getRechargePacks: async (_, __, context) => {
      const { user } = context;

      let where = {
        isActive: true,
      };

      if (user?.id) {
        // User ne kaun-kaun se packs purchase kiye hain
        const userPayments = await prisma.payment.findMany({
          where: {
            userId: user.id,
            status: "SUCCESS",
          },
          select: {
            rechargePackId: true,
          },
        });

        const purchasedPackIds = userPayments.map(
          (payment) => payment.rechargePackId,
        );

        where = {
          isActive: true,
          NOT: {
            AND: [
              {
                hideAfterFirstRecharge: true,
              },
              {
                id: {
                  in: purchasedPackIds,
                },
              },
            ],
          },
        };
      }

      const packs = await prisma.rechargePack.findMany({
        where,
        orderBy: {
          price: "asc",
        },
      });

      return {
        data: packs,
        totalCount: packs.length,
      };
    },
    getActiveSkills: async () => {
      return prisma.skill.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          sortOrder: "asc",
        },
        select: {
          id: true,
          name: true,
        },
      });
    },
    getActiveProblems: async () => {
      return prisma.problem.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          sortOrder: "asc",
        },
        select: {
          id: true,
          name: true,
        },
      });
    },
    getAstrologerCategories: async () => {
      const [skills, problems] = await Promise.all([
        prisma.skill.findMany({
          where: {
            isActive: true,
          },
          orderBy: {
            sortOrder: "asc",
          },
        }),

        prisma.problem.findMany({
          where: {
            isActive: true,
          },
          orderBy: {
            sortOrder: "asc",
          },
        }),
      ]);

      return [
        ...skills.map((item) => ({
          id: item.id,
          name: item.name,
          type: "SKILL",
        })),

        ...problems.map((item) => ({
          id: item.id,
          name: item.name,
          type: "PROBLEM",
        })),
      ];
    },
    getRechargePackById: async (_, { id }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized");
      }
      return await prisma.rechargePack.findUnique({
        where: { id },
      });
    },

    me: async (_, __, { user }) => {
      if (!user) {
        throw new Error("Unauthorized");
      }

      return await prisma.user.findUnique({
        where: { id: user.id },
      });
    },

    getUserById: async (_, { id }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          wallet: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      return user;
    },
    getAstrologerById: async (_, { id }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        const [astro, pricingConfig, usage, activeOffer] = await Promise.all([
          prisma.astrologer.findUnique({
            where: { id },
            include: {
              pricing: {
                where: {
                  isActive: true,
                },
              },
              reviews: {
                where: {
                  isFlagged: true,
                },
                orderBy: {
                  createdAt: "desc",
                },
              },
            },
          }),

          prisma.pricingConfig.findFirst(),

          prisma.userOfferUsage.findUnique({
            where: {
              userId,
            },
          }),

          prisma.astrologerOffer.findFirst({
            where: {
              astrologerId: id,
              isActive: true,
            },
            include: {
              offer: true,
            },
          }),
        ]);

        if (!astro) {
          throw new Error("Astrologer not found");
        }

        const specialOffer = activeOffer?.offer ?? null;

        return {
          id: astro.id,
          name: astro.name,
          displayName: astro.displayName,
          profilePic: astro.profilePic,
          about: astro.about,

          experience: astro.experience,
          rating: astro.rating,

          languages: astro.languages,
          skills: astro.skills,
          problems: astro.problems,

          isBusy: astro.isBusy,
          isOnline: astro.isOnline,
          isChatActive: astro.isChatActive,
          isCallActive: astro.isCallActive,
          isLiveActive: astro.isLiveActive,

          activeOffer: specialOffer
            ? {
                id: specialOffer.id,
                offerName: specialOffer.offerName,
                price: specialOffer.price,
                description: specialOffer.description,
              }
            : null,

          pricing: astro.pricing.map((p) => {
            let finalPrice = p.price;
            let appliedOffer = null;

            // 1. Special Offer
            if (specialOffer) {
              finalPrice = specialOffer.price;
              appliedOffer = specialOffer.offerName;
            }

            // 2. First Offer
            else if (pricingConfig?.isFirstOfferEnabled && !usage?.usedFirst) {
              finalPrice =
                p.type === "CHAT"
                  ? pricingConfig.firstChatPrice
                  : pricingConfig.firstCallPrice;

              appliedOffer = "FIRST_TIME_OFFER";
            }

            // 3. Second Offer
            else if (
              pricingConfig?.isSecondOfferEnabled &&
              usage?.usedFirst &&
              !usage?.usedSecond
            ) {
              finalPrice =
                p.type === "CHAT"
                  ? pricingConfig.secondChatPrice
                  : pricingConfig.secondCallPrice;

              appliedOffer = "SECOND_TIME_OFFER";
            }

            // 4. Global Offer
            else if (pricingConfig?.isGlobalOfferEnabled) {
              finalPrice =
                p.type === "CHAT"
                  ? pricingConfig.globalChatPrice
                  : pricingConfig.globalCallPrice;

              appliedOffer = "GLOBAL_OFFER";
            }

            return {
              id: p.id,
              type: p.type,

              price: finalPrice,
              originalPrice: p.price,
              offerPrice: p.offerPrice ?? null,

              commissionPercent: p.commissionPercent,
              appliedOffer,

              isActive: p.isActive,
            };
          }),

          reviews: astro.reviews,
        };
      } catch (error) {
        console.error(error);
        throw new Error(error.message);
      }
    },
    getUserChatHistory: async (_, { filter = {} }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const {
          page = 1,
          limit = 10,
          astrologerName,
          status,
          startDate,
          endDate,
        } = filter;

        const userId = context.user.id;

        const skip = (page - 1) * limit;

        /* =========================================
       SESSION FILTER
    ========================================= */
        const sessionWhere = {
          userId,

          ...(status && {
            status,
          }),

          ...(startDate || endDate
            ? {
                createdAt: {
                  ...(startDate && {
                    gte: new Date(startDate),
                  }),

                  ...(endDate && {
                    lte: new Date(endDate),
                  }),
                },
              }
            : {}),

          ...(astrologerName && {
            astrologer: {
              name: {
                contains: astrologerName,
                mode: "insensitive",
              },
            },
          }),
        };

        /* =========================================
       TOTAL COUNT
    ========================================= */
        const totalCount = await prisma.session.count({
          where: sessionWhere,
        });

        /* =========================================
       FETCH SESSIONS
    ========================================= */
        const sessions = await prisma.session.findMany({
          where: sessionWhere,

          include: {
            user: {
              select: {
                id: true,
                name: true,
                mobile: true,
                countryCode: true,
              },
            },

            astrologer: {
              select: {
                id: true,
                displayName: true,
                profilePic: true,
                experience: true,
                rating: true,
                skills: true,
                languages: true,

                pricing: {
                  where: {
                    isActive: true,
                  },

                  select: {
                    type: true,
                    price: true,
                    offerPrice: true,
                    commissionPercent: true,
                    isActive: true,
                  },
                },
              },
            },

            messages: {
              orderBy: {
                createdAt: "desc",
              },

              take: 1,

              select: {
                id: true,
                msgId: true,
                roomId: true,
                senderId: true,
                receiverId: true,
                message: true,
                image: true,
                sender: true,
                replyTo: true,
                createdAt: true,
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },

          skip,
          take: limit,
        });

        /* =========================================
       SUMMARY
    ========================================= */
        let totalCoinsDeducted = 0;
        let totalCoinsEarned = 0;
        let totalCommission = 0;

        sessions.forEach((session) => {
          totalCoinsDeducted += session.coinsDeducted || 0;
          totalCoinsEarned += session.coinsEarned || 0;
          totalCommission += session.commission || 0;
        });

        /* =========================================
       RESPONSE DATA
    ========================================= */
        const data = sessions.map((session, index) => {
          const lastMessage = session.messages?.[0] || null;

          // duration in minutes
          let durationMinutes = 0;

          if (session.durationSec) {
            durationMinutes = Math.ceil(session.durationSec / 60);
          }

          // active pricing
          const activePricing =
            session.astrologer?.pricing?.find((p) => p.type === "CHAT") ||
            session.astrologer?.pricing?.[0];

          return {
            srNo: skip + index + 1,

            roomId: lastMessage?.roomId || null,

            sessionId: session.id,
            source: session.source || null,

            startedAt: session.startedAt
              ? session.startedAt.toISOString()
              : null,

            endedAt: session.endedAt ? session.endedAt.toISOString() : null,

            createdAt: session.createdAt
              ? session.createdAt.toISOString()
              : null,

            status: session.status,

            durationSec: session.durationSec || 0,

            durationMinutes,

            ratePerMin:
              session.ratePerMin ||
              activePricing?.offerPrice ||
              activePricing?.price ||
              0,

            coinsDeducted: session.coinsDeducted || 0,

            coinsEarned: session.coinsEarned || 0,

            commission: session.commission || 0,

            user: {
              id: session.user?.id,
              name: session.user?.name,
              mobile: session.user?.mobile,
              countryCode: session.user?.countryCode,
            },

            astrologer: {
              id: session.astrologer?.id,
              name: session.astrologer?.displayName,
              profilePic: session.astrologer?.profilePic,
              experience: session.astrologer?.experience,
              rating: session.astrologer?.rating,
              skills: session.astrologer?.skills,
              languages: session.astrologer?.languages,
            },

            lastMessage: lastMessage
              ? {
                  id: lastMessage.id,
                  msgId: lastMessage.msgId,
                  roomId: lastMessage.roomId,
                  senderId: lastMessage.senderId,
                  receiverId: lastMessage.receiverId,
                  sender: lastMessage.sender,
                  message: lastMessage.message,
                  image: lastMessage.image,
                  replyTo: lastMessage.replyTo,

                  createdAt: lastMessage.createdAt
                    ? lastMessage.createdAt.toISOString()
                    : null,
                }
              : null,
          };
        });

        return {
          success: true,

          summary: {
            totalCoinsDeducted,
            totalCoinsEarned,
            totalCommission,
            totalRecords: totalCount,
          },

          data,

          totalCount,

          currentPage: page,

          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error("getUserChatHistory error:", error);

        throw new Error(error.message || "Failed to fetch chat history");
      }
    },

    getUserCallHistory: async (_, { filter = {} }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const {
          page = 1,
          limit = 10,
          astrologerName,
          status,
          startDate,
          endDate,
        } = filter;

        const userId = context.user.id;

        const skip = (page - 1) * limit;

        /* =========================================
       SESSION FILTER
    ========================================= */
        const sessionWhere = {
          userId,

          // ONLY CALL SESSIONS
          type: "CALL",

          ...(status && {
            status,
          }),

          ...(startDate || endDate
            ? {
                createdAt: {
                  ...(startDate && {
                    gte: new Date(startDate),
                  }),

                  ...(endDate && {
                    lte: new Date(endDate),
                  }),
                },
              }
            : {}),

          ...(astrologerName && {
            astrologer: {
              name: {
                contains: astrologerName,
                mode: "insensitive",
              },
            },
          }),
        };

        /* =========================================
       TOTAL COUNT
    ========================================= */
        const totalCount = await prisma.session.count({
          where: sessionWhere,
        });

        /* =========================================
       FETCH SESSIONS
    ========================================= */
        const sessions = await prisma.session.findMany({
          where: sessionWhere,

          include: {
            user: {
              select: {
                id: true,
                name: true,
                mobile: true,
                countryCode: true,
              },
            },

            astrologer: {
              select: {
                id: true,
                displayName: true,
                profilePic: true,
                experience: true,
                rating: true,
                skills: true,
                languages: true,

                pricing: {
                  where: {
                    isActive: true,
                  },

                  select: {
                    type: true,
                    price: true,
                    offerPrice: true,
                    commissionPercent: true,
                    isActive: true,
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt: "desc",
          },

          skip,
          take: limit,
        });

        /* =========================================
       SUMMARY
    ========================================= */
        let totalCoinsDeducted = 0;
        let totalCoinsEarned = 0;
        let totalCommission = 0;

        sessions.forEach((session) => {
          totalCoinsDeducted += session.coinsDeducted || 0;
          totalCoinsEarned += session.coinsEarned || 0;
          totalCommission += session.commission || 0;
        });

        /* =========================================
       RESPONSE DATA
    ========================================= */
        const data = sessions.map((session, index) => {
          // duration in minutes
          let durationMinutes = 0;

          if (session.durationSec) {
            durationMinutes = Math.ceil(session.durationSec / 60);
          }

          // active pricing
          const activePricing =
            session.astrologer?.pricing?.find((p) => p.type === "CALL") ||
            session.astrologer?.pricing?.[0];

          return {
            srNo: skip + index + 1,

            sessionId: session.id,

            startedAt: session.startedAt
              ? session.startedAt.toISOString()
              : null,

            endedAt: session.endedAt ? session.endedAt.toISOString() : null,

            createdAt: session.createdAt
              ? session.createdAt.toISOString()
              : null,

            status: session.status,

            durationSec: session.durationSec || 0,

            durationMinutes,

            ratePerMin:
              session.ratePerMin ||
              activePricing?.offerPrice ||
              activePricing?.price ||
              0,

            coinsDeducted: session.coinsDeducted || 0,

            coinsEarned: session.coinsEarned || 0,

            commission: session.commission || 0,

            user: {
              id: session.user?.id,
              name: session.user?.name,
              mobile: session.user?.mobile,
              countryCode: session.user?.countryCode,
            },

            astrologer: {
              id: session.astrologer?.id,
              name: session.astrologer?.displayName,
              profilePic: session.astrologer?.profilePic,
              experience: session.astrologer?.experience,
              rating: session.astrologer?.rating,
              skills: session.astrologer?.skills,
              languages: session.astrologer?.languages,
            },
          };
        });

        return {
          success: true,

          summary: {
            totalCoinsDeducted,
            totalCoinsEarned,
            totalCommission,
            totalRecords: totalCount,
          },

          data,

          totalCount,

          currentPage: page,

          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error("getUserCallHistory error:", error);

        throw new Error(error.message || "Failed to fetch call history");
      }
    },

    getGifts: async (_, __, context) => {
      try {
        const gifts = await prisma.gift.findMany({
          where: {
            status: "active",
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        return {
          data: gifts,
          totalCount: gifts.length,
        };
      } catch (error) {
        console.error("getGifts error:", error);
        throw new Error(error.message || "Failed to fetch gifts");
      }
    },

    getBanners: async (_, { language }) => {
      try {
        const whereCondition = {
          status: true,

          ...(language && {
            language,
          }),
        };

        const banners = await prisma.banner.findMany({
          where: whereCondition,

          orderBy: {
            sortorder: "asc",
          },
        });

        return {
          data: banners,
          totalCount: banners.length,
        };
      } catch (error) {
        console.error("getBanners error:", error);

        throw new Error(error.message || "Failed to fetch banners");
      }
    },
    getFaqs: async () => {
      try {
        const faqs = await prisma.faq.findMany({
          orderBy: {
            createdAt: "desc",
          },
        });

        return {
          data: faqs,
          totalCount: faqs.length,
        };
      } catch (error) {
        console.error("getFaqs error:", error);

        throw new Error(error.message || "Failed to fetch FAQs");
      }
    },

    getTestimonials: async () => {
      try {
        const testimonials = await prisma.testimonial.findMany({
          orderBy: {
            createdAt: "desc",
          },
        });

        return {
          data: testimonials,
          totalCount: testimonials.length,
        };
      } catch (error) {
        console.error("getTestimonials error:", error);

        throw new Error(error.message || "Failed to fetch testimonials");
      }
    },

    getRemedies: async () => {
      try {
        const remedies = await prisma.remedy.findMany({
          where: {
            isActive: true,
          },

          orderBy: {
            createdAt: "desc",
          },
        });

        return {
          data: remedies.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            isActive: item.isActive,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          })),

          totalCount: remedies.length,
        };
      } catch (error) {
        console.error("getRemedies error:", error);

        throw new Error("Failed to fetch remedies");
      }
    },
    getAboutPage: async () => {
      try {
        const aboutPage = await prisma.aboutPage.findFirst({
          where: {
            status: "PUBLISHED",
          },
        });

        if (!aboutPage) {
          throw new Error("About page not found");
        }

        return {
          id: aboutPage.id,
          pageType: aboutPage.pageType,
          heroTitle: aboutPage.heroTitle,
          heroDescription: aboutPage.heroDescription,

          mentors: aboutPage.mentors || [],

          founders: aboutPage.founders || [],

          metaTitle: aboutPage.metaTitle,
          metaDescription: aboutPage.metaDescription,
          keywords: aboutPage.keywords || [],

          status: aboutPage.status,

          createdAt: aboutPage.createdAt.toISOString(),
          updatedAt: aboutPage.updatedAt.toISOString(),
        };
      } catch (error) {
        console.error("getAboutPage error:", error);

        throw new Error("Failed to fetch about page");
      }
    },
    getPrivacyPage: async () => {
      return await prisma.privacyPage.findFirst({
        where: {
          pageType: "privacy-policy",
        },
      });
    },
    getRefundPolicyPage: async () => {
      return await prisma.refundPolicyPage.findFirst({
        where: {
          pageType: "refund-policy",
        },
      });
    },
    getDisclaimerPage: async () => {
      return await prisma.disclaimerPage.findFirst({
        where: {
          pageType: "disclaimer",
        },
      });
    },

    getAppVersion: async (_, { platform }) => {
      try {
        const appVersion = await prisma.appVersion.findFirst({
          where: {
            platform,
          },

          orderBy: {
            createdAt: "desc",
          },
        });

        if (!appVersion) {
          throw new Error("App version not found");
        }

        return {
          id: appVersion.id,

          platform: appVersion.platform,

          latestVersion: appVersion.latestVersion,

          minimumVersion: appVersion.minimumVersion,

          forceUpdate: appVersion.forceUpdate,

          maintenanceMode: appVersion.maintenanceMode,

          maintenanceMessage: appVersion.maintenanceMessage,

          playStoreUrl: appVersion.playStoreUrl,

          appStoreUrl: appVersion.appStoreUrl,

          releaseNotes: appVersion.releaseNotes,

          createdAt: appVersion.createdAt.toISOString(),

          updatedAt: appVersion.updatedAt.toISOString(),
        };
      } catch (error) {
        console.error("getAppVersion error:", error);

        throw new Error(error.message || "Failed to fetch app version");
      }
    },
    getChatMessagesBySessionId: async (_, { sessionId }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        if (!sessionId) {
          throw new Error("Session ID is required");
        }

        const messages = await prisma.message.findMany({
          where: {
            sessionId,
          },

          orderBy: {
            createdAt: "asc",
          },
        });

        return messages.map((msg) => ({
          id: msg.id,
          msgId: msg.msgId,
          roomId: msg.roomId,

          senderId: msg.senderId,
          receiverId: msg.receiverId,

          message: msg.message,
          image: msg.image,

          sender: msg.sender,

          replyTo: msg.replyTo,
          time: msg.time,

          createdAt: msg.createdAt ? msg.createdAt.toISOString() : null,
        }));
      } catch (error) {
        console.error("getChatMessagesBySessionId error:", error);

        throw new Error(error.message || "Failed to fetch session messages");
      }
    },
    getSessionRemedy: async (_, { sessionId }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized");
      }

      const remedy = await prisma.sessionRemedy.findFirst({
        where: {
          sessionId,
        },
        include: {
          session: {
            include: {
              astrologer: true,
            },
          },
        },
      });

      if (!remedy) return null;

      return {
        id: remedy.id,
        remedyText: remedy.remedyText,
        createdAt: remedy.createdAt.toISOString(),
        astrologerName: remedy.session.astrologer.name,
      };
    },

    getUserSessions: async (_, { filter }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        const {
          status,
          type,
          fromDate,
          toDate,
          page = 1,
          limit = 10,
        } = filter || {};

        const skip = (page - 1) * limit;

        // -----------------------------------
        // BUILD DYNAMIC WHERE CONDITION
        // -----------------------------------

        const where = {
          userId,

          ...(status && {
            status,
          }),

          ...(type && {
            type,
          }),

          ...(fromDate || toDate
            ? {
                createdAt: {
                  ...(fromDate && {
                    gte: new Date(fromDate),
                  }),

                  ...(toDate && {
                    lte: new Date(toDate),
                  }),
                },
              }
            : {}),
        };

        console.log("getUserSessions where:", where);

        // -----------------------------------
        // FETCH SESSIONS + COUNT
        // -----------------------------------

        const [sessions, totalCount] = await Promise.all([
          prisma.session.findMany({
            where,

            include: {
              user: {
                select: {
                  name: true,
                },
              },

              astrologer: {
                select: {
                  name: true,
                  displayName: true,
                  profilePic: true,
                },
              },
            },

            orderBy: {
              createdAt: "desc",
            },

            skip,
            take: limit,
          }),

          prisma.session.count({
            where,
          }),
        ]);

        // -----------------------------------
        // TRANSFORM RESPONSE
        // -----------------------------------

        const formatted = sessions.map((s) => {
          const ratePerSecond = Number(s.ratePerMin || 0) / 60;

          return {
            id: s.id,

            userName: s.user?.name || "",

            astrologerName: s.astrologer?.name || "",

            displayName: s.astrologer?.displayName || "",

            astrologerImage: s.astrologer?.profilePic || "",

            // -----------------------------------
            // CALL / CHAT
            // -----------------------------------
            type: s.type,

            status: s.status,

            startedAt: s.startedAt,

            endedAt: s.endedAt,

            durationSec: s.durationSec || 0,

            durationMin: Math.ceil((s.durationSec || 0) / 60),

            ratePerMin: s.ratePerMin,

            ratePerSecond: Number(ratePerSecond.toFixed(2)),

            totalCharge: s.coinsDeducted,

            coinsEarned: s.coinsEarned,

            commission: s.commission,
          };
        });

        // -----------------------------------
        // RESPONSE
        // -----------------------------------

        return {
          data: formatted,

          totalCount,

          currentPage: page,

          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error("getUserSessions error:", error);

        throw new Error(error.message || "Failed to fetch sessions");
      }
    },

    getChatMessages: async (_, { roomId, limit = 50, offset = 0 }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        if (!roomId) {
          throw new Error("roomId is required");
        }

        const redisKey = `chat_messages:${roomId}`;

        //  Pagination (important for performance)
        // Example: last 50 messages
        const start = -(offset + limit);
        const end = offset === 0 ? -1 : -(offset + 1);

        const rawMessages = await redis.lrange(redisKey, start, end);

        if (!rawMessages || rawMessages.length === 0) {
          return [];
        }

        const parsedMessages = [];

        for (const msg of rawMessages) {
          try {
            const parsed = JSON.parse(msg);

            parsedMessages.push({
              msg_id: parsed.msg_id || "",
              sender_id: parsed.sender_id || "",
              room_id: parsed.room_id || "",
              received_id: parsed.received_id || "",
              message: parsed.message || "",
              image: parsed.image || null,
              sender: parsed.sender || "",
              replyTo: parsed.replyTo || null,

              //  FIX TIME FORMAT ISSUE
              time: isNaN(new Date(parsed.time).getTime())
                ? new Date().toISOString()
                : new Date(parsed.time).toISOString(),
            });
          } catch (err) {
            console.error("Invalid message JSON:", msg);
          }
        }

        //  Ensure correct order (old → new)
        parsedMessages.sort((a, b) => new Date(a.time) - new Date(b.time));

        return parsedMessages;
      } catch (error) {
        console.error("getChatMessages error:", error);
        throw new Error(error.message || "Failed to fetch chat messages");
      }
    },

    recentIntakes: async (_, __, context) => {
      try {
        const userId = context.user.id;

        if (!userId) {
          throw new Error("Unauthorized");
        }

        const recentIntakes = await prisma.intake.findMany({
          where: {
            userId: userId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          include: {
            astrologer: true, // optional if you want astrologer details
          },
        });

        return {
          success: true,
          message: "Recent intake fetched successfully",
          data: recentIntakes,
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },
    getFreeServices: async () => {
      try {
        const services = await prisma.freeService.findMany({
          where: {
            isActive: true,
          },
          orderBy: [
            {
              order: "asc",
            },
            {
              createdAt: "desc",
            },
          ],
        });

        return {
          data: services.map((item) => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            href: item.href,
            icon: item.icon,
            isActive: item.isActive,
            order: item.order,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          })),
          totalCount: services.length,
        };
      } catch (error) {
        console.error("getFreeServices error:", error);

        throw new Error(error.message || "Failed to fetch free services");
      }
    },

    getFreeServiceById: async (_, { id }) => {
      try {
        const service = await prisma.freeService.findUnique({
          where: {
            id,
          },
        });

        if (!service) {
          throw new Error("Free service not found");
        }

        return {
          id: service.id,
          title: service.title,
          slug: service.slug,
          href: service.href,
          icon: service.icon,
          isActive: service.isActive,
          order: service.order,
          createdAt: service.createdAt.toISOString(),
          updatedAt: service.updatedAt.toISOString(),
        };
      } catch (error) {
        console.error("getFreeServiceById error:", error);

        throw new Error(error.message || "Failed to fetch free service");
      }
    },

    getGiftHistory: async (_, args, context) => {
      try {
        const giftHistory = await prisma.giftHistory.findMany({
          orderBy: {
            createdAt: "desc",
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                mobile: true,
              },
            },
            astrologer: {
              select: {
                id: true,
                name: true,
                profilePic: true,
              },
            },
          },
        });

        return giftHistory.map((item) => ({
          id: item.id,
          userId: item.userId,
          astrologerId: item.astrologerId,
          giftId: item.giftId,
          giftName: item.giftName,
          giftPrice: item.giftPrice,
          createdAt: item.createdAt.toISOString(),

          user: item.user,
          astrologer: item.astrologer,
        }));
      } catch (error) {
        console.error("getGiftHistory error:", error);
        throw new Error(error.message);
      }
    },
    isFollowing: async (_, { astrologerId }, context) => {
      try {
        const { user } = context;

        if (!user) {
          return {
            isFollowing: false,
          };
        }

        const follow = await prisma.astrologerFollow.findUnique({
          where: {
            userId_astrologerId: {
              userId: user.id,
              astrologerId,
            },
          },
        });

        return {
          isFollowing: !!follow,
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },
    getAstrologerFollowersCount: async (_, { astrologerId }, context) => {
      try {
        // const { prisma } = context;

        const totalFollowers = await prisma.astrologerFollow.count({
          where: {
            astrologerId,
          },
        });

        return {
          totalFollowers,
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },
    getFollowedAstrologers: async (_, { page = 1, limit = 10 }, context) => {
      try {
        const { user } = context;

        if (!user) {
          throw new Error("Unauthorized");
        }

        const skip = (page - 1) * limit;

        const total = await prisma.astrologerFollow.count({
          where: {
            userId: user.id,
          },
        });

        const followedAstrologers = await prisma.astrologerFollow.findMany({
          where: {
            userId: user.id,
          },
          include: {
            astrologer: {
              include: {
                pricing: true,
                wallet: true,
                offers: {
                  include: {
                    offer: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          skip,
          take: limit,
        });

        return {
          astrologers: followedAstrologers.map((follow) => ({
            ...follow.astrologer,

            isChatActive: follow.astrologer.isChatActive,
            isCallActive: follow.astrologer.isCallActive,
            isLiveActive: follow.astrologer.isLiveActive,
            isPromotional: follow.astrologer.isPromotional,
            isBusy: follow.astrologer.isBusy,
          })),
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },

    getSessionRemedies: async (_, { sessionId }, context) => {
      try {
        const { user } = context;

        if (!user) {
          throw new Error("Unauthorized");
        }

        return await prisma.sessionRemedy.findMany({
          where: {
            sessionId,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } catch (error) {
        throw new Error(error.message);
      }
    },

    getCategories: async () => {
      try {
        const categories = await prisma.category.findMany({
          orderBy: {
            createdAt: "desc",
          },
        });

        return categories.map((category) => ({
          ...category,
          createdAt: category.createdAt.toISOString(),
        }));
      } catch (error) {
        console.error("getCategories error:", error);

        throw new Error(error.message || "Failed to fetch categories");
      }
    },

    getCategory: async (_, { slug }) => {
      try {
        const category = await prisma.category.findUnique({
          where: { slug },
          include: {
            services: {
              include: {
                astrologerMappings: {
                  select: {
                    price: true,
                  },
                },
              },
            },
          },
        });

        if (!category) {
          throw new Error("Category not found");
        }

        return {
          ...category,
          createdAt: category.createdAt.toISOString(),
          services: category.services.map((service) => ({
            ...service,
            price:
              service.astrologerMappings.length > 0
                ? Math.min(...service.astrologerMappings.map((m) => m.price))
                : null,
            createdAt: service.createdAt.toISOString(),
            updatedAt: service.updatedAt.toISOString(),
          })),
        };
      } catch (error) {
        console.error("getCategory error:", error);

        throw new Error(error.message || "Failed to fetch category");
      }
    },

    getServices: async () => {
      try {
        const services = await prisma.service.findMany({
          include: {
            category: true,

            astrologerMappings: {
              select: {
                price: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        return services.map((service) => ({
          ...service,
          createdAt: service.createdAt.toISOString(),
          updatedAt: service.updatedAt.toISOString(),
          category: service.category
            ? {
                ...service.category,
                createdAt: service.category.createdAt.toISOString(),
              }
            : null,
        }));
      } catch (error) {
        console.error("getServices error:", error);

        throw new Error(error.message || "Failed to fetch services");
      }
    },

    getService: async (_, { slug }) => {
      try {
        const service = await prisma.service.findUnique({
          where: {
            slug,
          },

          include: {
            category: true,

            astrologerMappings: {
              include: {
                astrologer: {
                  include: {
                    pricing: {
                      where: {
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!service) {
          throw new Error("Service not found");
        }

        return {
          ...service,

          createdAt: service.createdAt.toISOString(),
          updatedAt: service.updatedAt.toISOString(),

          category: service.category
            ? {
                ...service.category,
                createdAt: service.category.createdAt.toISOString(),
              }
            : null,

          astrologerMappings: service.astrologerMappings.map((mapping) => ({
            ...mapping,

            astrologer: {
              ...mapping.astrologer,
            },
          })),
        };
      } catch (error) {
        console.error("getService error:", error);

        throw new Error(error.message || "Failed to fetch service");
      }
    },
    // getServiceBooking: async (_, { id }) => {
    //   return prisma.serviceBooking.findUnique({
    //     where: { id },
    //     include: {
    //       service: true,
    //     },
    //   });
    // },

    getMyServiceBookings: async (_, { page = 1, limit = 10 }, { user }) => {
      const skip = (page - 1) * limit;

      const [data, totalCount] = await Promise.all([
        prisma.serviceBooking.findMany({
          where: {
            userId: user.id,
          },
          include: {
            service: true,
            astrologer: true,
          },
          orderBy: {
            createdAt: "desc",
          },
          skip,
          take: limit,
        }),
        prisma.serviceBooking.count({
          where: {
            userId: user.id,
          },
        }),
      ]);

      return {
        data,
        totalCount,
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
      };
    },

    blogs: async () => {
      const blogs = await prisma.blog.findMany({
        include: {
          categories: {
            include: {
              category: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return blogs.map((blog) => ({
        ...blog,
        categories: blog.categories?.map((item) => item.category) || [],
      }));
    },
    blogBySlug: async (_, { slug }) => {
      const blog = await prisma.blog.findUnique({
        where: {
          slug,
        },
        include: {
          categories: {
            include: {
              category: true,
            },
          },
        },
      });

      return {
        ...blog,
        categories: blog?.categories?.map((item) => item.category) || [],
      };
    },
    blogCategories: async () => {
      const data = await prisma.blogCategory.findMany();
      return data;
    },
    getSimilarAstrologers: async (_, { astrologerId }, context) => {
      
      try {
        // if (!context.user) {
        //   throw new Error("Unauthorized");
        // }

        const userId = context.user.id;

        const currentAstro = await prisma.astrologer.findUnique({
          where: {
            id: astrologerId,
          },
          select: {
            skills: true,
          },
        });

        if (!currentAstro) {
          throw new Error("Astrologer not found");
        }

        const skills = currentAstro.skills || [];

        let astrologers = await prisma.astrologer.findMany({
          where: {
            id: {
              not: astrologerId,
            },
            skills: {
              hasSome: skills,
            },
          },
          include: {
            pricing: {
              where: {
                isActive: true,
              },
            },
          },
          take: 6,
        });

        if (astrologers.length < 6) {
          const existingIds = [astrologerId, ...astrologers.map((i) => i.id)];

          const randomAstros = await prisma.astrologer.findMany({
            where: {
              id: {
                notIn: existingIds,
              },
            },
            include: {
              pricing: {
                where: {
                  isActive: true,
                },
              },
            },
            take: 6 - astrologers.length,
          });

          astrologers = [...astrologers, ...randomAstros];
        }

        const pricingConfig = await prisma.pricingConfig.findFirst();

        const usage = await prisma.userOfferUsage.findUnique({
          where: {
            userId,
          },
        });

        const result = [];

        for (const astro of astrologers) {
          const activeOffer = await prisma.astrologerOffer.findFirst({
            where: {
              astrologerId: astro.id,
              isActive: true,
            },
            include: {
              offer: true,
            },
          });

          const specialOffer = activeOffer?.offer ?? null;

          result.push({
            ...astro,

            activeOffer: specialOffer
              ? {
                  id: specialOffer.id,
                  offerName: specialOffer.offerName,
                  price: specialOffer.price,
                  description: specialOffer.description,
                }
              : null,

            pricing: astro.pricing.map((p) => {
              let finalPrice = p.price;
              let appliedOffer = null;

              if (specialOffer) {
                finalPrice = specialOffer.price;
                appliedOffer = specialOffer.offerName;
              } else if (
                pricingConfig?.isFirstOfferEnabled &&
                !usage?.usedFirst
              ) {
                finalPrice =
                  p.type === "CHAT"
                    ? pricingConfig.firstChatPrice
                    : pricingConfig.firstCallPrice;

                appliedOffer = "FIRST_TIME_OFFER";
              } else if (
                pricingConfig?.isSecondOfferEnabled &&
                usage?.usedFirst &&
                !usage?.usedSecond
              ) {
                finalPrice =
                  p.type === "CHAT"
                    ? pricingConfig.secondChatPrice
                    : pricingConfig.secondCallPrice;

                appliedOffer = "SECOND_TIME_OFFER";
              } else if (pricingConfig?.isGlobalOfferEnabled) {
                finalPrice =
                  p.type === "CHAT"
                    ? pricingConfig.globalChatPrice
                    : pricingConfig.globalCallPrice;

                appliedOffer = "GLOBAL_OFFER";
              }

              return {
                ...p,
                price: finalPrice,
                originalPrice: p.price,
                appliedOffer,
              };
            }),
          });
        }

        return result;
      } catch (error) {
        console.error(error);
        throw new Error(error.message);
      }
    },
    getUpcomingLives: async (_, { page = 1, limit = 10 }) => {
      try {
        const skip = (page - 1) * limit;

        const where = {
          status: {
            in: ["LIVE", "SCHEDULED"],
          },
        };

        const [data, totalCount] = await Promise.all([
          prisma.liveStream.findMany({
            where,

            include: {
              astrologer: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                  profilePic: true,
                  rating: true,
                },
              },
            },

            orderBy: {
              scheduledAt: "asc",
            },

            skip,
            take: limit,
          }),

          prisma.liveStream.count({
            where,
          }),
        ]);

        return {
          data,
          totalCount,
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
        };
      } catch (error) {
        console.error("getUpcomingLives Error:", error);

        throw new Error(error.message || "Failed to fetch upcoming lives");
      }
    },

    joinLive: async (_, { channelName }, { user }) => {
      try {
        if (!user) {
          throw new Error("Unauthorized");
        }

        // Find active live
        const stream = await prisma.liveStream.findFirst({
          where: {
            channelName,
            status: "LIVE",
          },
        });

        if (!stream) {
          throw new Error("Live stream not found");
        }

        // Make sure chat room exists
        if (!stream.chatRoomId) {
          throw new Error("Chat room not found for this live stream");
        }

        // Generate RTC UID
        const uid = Math.floor(Math.random() * 1000000);

        // RTC Token
        const rtcToken = generateRtcToken({
          channelName,
          uid,
          role: "subscriber",
        });

        // Agora Chat username
        const chatUserId = `user_${user.id}`;

        // Create chat user if not exists
        await createAgoraChatUser(chatUserId);

        // Generate chat token
        const chatToken = await generateChatToken(chatUserId);

        const response = {
          rtcToken,
          uid,
          appId: process.env.AGORA_APP_ID,
          channelName,

          chatUserId,
          chatToken,
          chatRoomId: stream.chatRoomId,
          chatAppKey: process.env.AGORA_CHAT_APP_KEY,
        };

        return response;
      } catch (error) {
        console.error(error.response?.data || error);
        throw new Error(error.message || "Failed to join live stream");
      }
    },
    getCoupons: async () => {
      try {
        return await prisma.coupon.findMany({
          where: {
            status: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } catch (error) {
        throw error;
      }
    },
    getServiceBooking: async (_, { bookingId }) => {
      return prisma.serviceBooking.findUnique({
        where: {
          id: bookingId,
        },
        include: {
          service: true,
          astrologer: true,
        },
      });
    },
getPaymentInvoice: async (_, { transactionId }) => {
  try {
    const transaction = await prisma.walletTransaction.findUnique({
      where: {
        id: transactionId,
      },
      include: {
        userWallet: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new Error("Wallet transaction not found");
    }

    if (transaction.description !== "Recharge successful") {
      throw new Error("Invoice is available only for wallet recharge");
    }

const userId = transaction.userWallet?.user?.id;

const payment = await prisma.payment.findFirst({
  where: {
    rechargePackId: transaction.rechargePackId,
    status: "SUCCESS",
    userId: userId,
  },
  orderBy: {
    createdAt: "desc",
  },
});

    if (!payment) {
      throw new Error("Payment not found");
    }

    const amount = Number(payment.amount || 0);
    const gstRate = Number(payment.gstRate || 18);

    const taxableAmount =
      amount / (1 + gstRate / 100);

    const totalTax =
      amount - taxableAmount;

    return {
      id: transaction.id,

      invoiceNo:
        payment.invoiceNo ||
        `INV-${transaction.id.slice(0, 8)}`,

      transactionId:
        payment.transactionId ||
        transaction.id,

      razorpayOrderId:
        payment.razorpayOrderId || null,

      razorpayPaymentId:
        payment.razorpayPaymentId || null,

      amount: taxableAmount,

      discount: 0,

      taxableAmount,

      sgst: 0,
      cgst: 0,
      igst: totalTax,

      sgstRate: 0,
      cgstRate: 0,
      igstRate: gstRate,

      gstRate,

      totalTax,

      totalAmount: amount,

      amountReceived: amount,

      amountInWords:
        payment.amountInWords || null,

      userName:
        transaction.userWallet?.user?.name || "-",

   city:
  payment.city || "-",

state:
  payment.state || "-",

pincode:
  "-", 

      country:
        transaction.userWallet?.user?.country || "India",

      placeOfSupply:
        transaction.userWallet?.user?.state || "-",

      supplierGSTIN:
        payment.supplierGSTIN || "07ABBFM1961C1ZN",

      supplierAddress:
        payment.supplierAddress || "2ND FLOOR, 1511/2B, Kotla Mubarakpur, Bhishma Pitamah Marg, Wazir Nagar, New Delhi, South East Delhi, Delhi, 110003",

      website:
        payment.website || "www.dhwaniastro.com",

      email:
        payment.email || "support@dhwaniastro.com",

      recipientGSTIN:
        payment.recipientGSTIN || "-",

      transactionHistoryUrl:
        payment.transactionHistoryUrl || "-",

      hsnSac:
        payment.hsnSac || "999799",

      reverseCharge:
        payment.reverseCharge || false,

      panNumber:
        payment.panNumber || "-",

      createdAt:
        transaction.createdAt,
    };
  } catch (error) {
    console.error("getPaymentInvoice error:", error);

    throw new Error(
      error.message || "Failed to fetch payment invoice"
    );
  }
},
  },
  //----------------start code for mutation ----------------------------
  Mutation: {
    requestOtp: async (_, { countryCode, mobile }) => {
      try {
        if (!countryCode || !mobile) {
          throw new Error("Country code and mobile required");
        }

        const result = await sendOTPService(countryCode, mobile);

        await logEvent({
          action: "REQUEST_OTP",
          details: { countryCode, mobile },
        });

        return result;
      } catch (error) {
        throw new Error(error.message || "Failed to request OTP");
      }
    },

    authWithOtp: async (_, { countryCode, mobile, otp, source }, { res }) => {
      try {
        if (!countryCode || !mobile)
          throw new Error("Country code and mobile required");
        if (!otp) throw new Error("OTP required");

        const { accessToken, refreshToken, user, isNewUser, hasName } =
          await verifyOTPService(countryCode, mobile, otp, source);

        if (res?.setHeader) {
          res.cookie("accessToken", accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            domain: ".dhwaniastro.com",
            maxAge: 1 * 24 * 60 * 60 * 1000,
            path: "/",
          });

          res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            domain: ".dhwaniastro.com",
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: "/",
          });
        }

        await logEvent({
          userId: user.id,
          action: "LOGIN_OTP",
          details: {
            countryCode,
            mobile,
            source,
          },
        });

        return {
          user,
          accessToken,
          refreshToken,
          isNewUser,
          hasName,
        };
      } catch (error) {
        await logEvent({
          action: "FAILED_LOGIN_OTP",
          details: {
            countryCode,
            mobile,
            source,
            error: error.message,
          },
        });

        throw new Error(error.message || "Failed to authenticate with OTP");
      }
    },

    refreshToken: async (_, { token }, { res }) => {
      try {
        if (!token) throw new Error("Refresh token required");

        const { accessToken, refreshToken, user } =
          await refreshTokenService(token);

        if (res?.setHeader) {
          res.setHeader("Set-Cookie", [
            cookie.serialize("accessToken", accessToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "Strict",
              maxAge: 60 * 15,
              path: "/",
            }),
            cookie.serialize("refreshToken", refreshToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "Strict",
              maxAge: 60 * 60 * 24 * 7,
              path: "/",
            }),
          ]);
        }

        await logEvent({ userId: user.id, action: "REFRESH_TOKEN" });

        return { user, accessToken, refreshToken };
      } catch (error) {
        throw new Error(error.message || "Invalid refresh token");
      }
    },

    updateUserProfile: async (_, { input }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized. Please login.");
      }

      const dbUser = await prisma.user.findUnique({
        where: {
          id: context.user.id,
        },
      });

      if (!dbUser) {
        throw new Error(
          `Authenticated user not found. User ID: ${context.user.id}`,
        );
      }

      const updatedUser = await prisma.user.update({
        where: {
          id: context.user.id,
        },
        data: {
          name: input.name,
          gender: input.gender,
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          birthTime: input.birthTime,
          occupation: input.occupation,
          birthPlace: input.birthPlace || null,
          profileImage: input.profileImage || dbUser.profileImage,
        },
      });

      await logEvent({
        userId: context.user.id,
        action: "UPDATE_PROFILE",
        details: input,
      });

      return updatedUser;
    },

    // intake for chat

    createIntake: async (_, { input }, context) => {
      if (!context.user) {
        throw new Error("Unauthorized");
      }
      const userId = context.user.id;

      // Generate Room ID
      const roomId = uuidv4();
      // Get User Wallet
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          wallet: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }
      const existingIntake = await prisma.intake.findFirst({
        where: {
          userId,
        },
        select: {
          id: true,
        },
      });

      const isFirstIntake = !existingIntake;

      // if (!user || !user.wallet) {
      //   throw new Error("Insufficient balance.Please Recharge your wallet.");
      // }

      const userQueueKey = `user_in_queue`;

      // Check duplicate user
      const alreadyExists = await redis.sismember(userQueueKey, userId);

      if (alreadyExists) {
        throw new Error(
          "Duplicate request. User has already submitted a request.",
        );
      }

      const walletBalance = user?.wallet?.balanceCoins || 0;

      // Get Astrologer with Pricing
      const astrologer = await prisma.astrologer.findUnique({
        where: { id: input.astrologerId },
        include: {
          pricing: {
            where: {
              type:
                input.requestType.toUpperCase() === "CALL" ? "CALL" : "CHAT",
              isActive: true,
            },
          },
        },
      });

      // Get pricing config
      const pricingConfig = await prisma.pricingConfig.findFirst();

      // Get or create user offer usage
      let userOfferUsage = await prisma.userOfferUsage.findUnique({
        where: {
          userId,
        },
      });

      if (!userOfferUsage) {
        userOfferUsage = await prisma.userOfferUsage.create({
          data: {
            userId,
          },
        });
      }

      if (!astrologer) {
        throw new Error("Astrologer not found");
      }

      if (
        input.requestType.toUpperCase() === "CALL" &&
        !astrologer.isCallActive
      ) {
        throw new Error("Call service is disabled by astrologer");
        return;
      }

      if (
        input.requestType.toUpperCase() === "CHAT" &&
        !astrologer.isChatActive
      ) {
        throw new Error("Chat service is disabled by astrologer");
        return;
      }

      if (!astrologer.isOnline) {
        throw new Error("Astrologer is offline");
        return;
      }

      // Get pricing according to request type
      const pricing = astrologer.pricing?.[0];

      if (!pricing) {
        throw new Error(
          `${input.requestType} pricing not configured for astrologer`,
        );
      }
      const activeOffer = await prisma.astrologerOffer.findFirst({
        where: {
          astrologerId: input.astrologerId,
          isActive: true,
        },
        include: {
          offer: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      // DEFAULT PRICE

      let pricePerMin = Number(pricing.price);
      let appliedOffer = "NORMAL";

      const requestType =
        input.requestType.toUpperCase() === "CALL" ? "CALL" : "CHAT";

      // ----------------------------------------------------
      // FIRST TIME OFFER
      // ----------------------------------------------------

      if (
        pricingConfig?.isFirstOfferEnabled &&
        !userOfferUsage.firstOfferUsedAt
      ) {
        pricePerMin =
          requestType === "CALL"
            ? Number(pricingConfig.firstCallPrice)
            : Number(pricingConfig.firstChatPrice);

        appliedOffer = "FIRST_TIME_OFFER";
        console.log("FIRST_TIME_OFFER price --------", pricePerMin);
      }

      // ----------------------------------------------------
      // SECOND TIME OFFER
      // ----------------------------------------------------
      else if (
        pricingConfig?.isSecondOfferEnabled &&
        !userOfferUsage.secondOfferUsedAt
      ) {
        pricePerMin =
          requestType === "CALL"
            ? Number(pricingConfig.secondCallPrice)
            : Number(pricingConfig.secondChatPrice);

        console.log("SECOND price --------", pricePerMin);

        appliedOffer = "SECOND_TIME_OFFER";
      }

      // ----------------------------------------------------
      // GLOBAL OFFER
      // ----------------------------------------------------
      else if (pricingConfig?.isGlobalOfferEnabled) {
        pricePerMin =
          requestType === "CALL"
            ? Number(pricingConfig.globalCallPrice)
            : Number(pricingConfig.globalChatPrice);

        console.log("GLOBAL price --------", pricePerMin);

        appliedOffer = "GLOBAL_OFFER";
      }

      // ----------------------------------------------------
      // BIRTHDAY / DIWALI / SPECIAL OFFER
      // ----------------------------------------------------
      else if (
        activeOffer?.offer &&
        activeOffer.offer.isActive &&
        Number(activeOffer.offer.price) >= 0
      ) {
        pricePerMin = Number(activeOffer.offer.price);
        console.log("SPECIAL price --------", pricePerMin);
        appliedOffer =
          activeOffer.offer.offerName || "ASTROLOGER_SPECIAL_OFFER";
      }

      // ----------------------------------------------------
      // ASTROLOGER OFFER PRICE
      // ----------------------------------------------------
      // else if (pricing.offerPrice && Number(pricing.offerPrice) >= 0) {
      //   pricePerMin = Number(pricing.offerPrice);
      //    console.log("OFFER price --------",pricePerMin);

      //   appliedOffer = "ASTROLOGER_OFFER_PRICE";
      // }

      // ----------------------------------------------------
      // NORMAL PRICE
      // ----------------------------------------------------
      else {
        pricePerMin = Number(pricing.price);
        console.log("NORMAL price --------", pricePerMin);

        appliedOffer = "NORMAL";
      }

      // ----------------------------------------------------
      // VALIDATION
      // ----------------------------------------------------

      // if (!pricePerMin || Number(pricePerMin) <= 0) {
      //   throw new Error("Invalid astrologer pricing");
      // }

      // console.log("Final Price:", pricePerMin);
      // console.log("Applied Offer:", appliedOffer);

      // if (pricePerMin <= 0) {
      //   throw new Error("Invalid astrologer pricing");
      // }
      console.log("Price per minute:", pricePerMin);
      // Calculate Chat/Call Time
      let chatTime = 0;
      if (pricePerMin == 0) {
        chatTime = 3;
      } else {
        chatTime = Math.floor(walletBalance / pricePerMin);
      }

      if (chatTime <= 0 && pricePerMin != 0) {
        throw new Error("Insufficient balance");
      }

      if (chatTime < 5 && pricePerMin != 0) {
        throw new Error("balance must be minimum 5 minutes");
      }

      const intake = await prisma.intake.create({
        data: {
          userId,
          astrologerId: input.astrologerId,
          name: input.name,
          countryCode: input.countryCode,
          mobile: input.mobile,
          gender: input.gender,
          birthDate: new Date(input.birthDate),
          birthTime: input.birthTime,
          occupation: input.occupation,
          birthPlace: input.birthPlace,
          requestType: input.requestType,
          chatId: roomId,
          appliedOffer,
          pricePerMin,
          latitude: input.latitude,
          longitude: input.longitude,
          source: input.source,
        },
      });
      if (isFirstIntake) {
        await prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            name: input.name,
            gender: input.gender,
            birthDate: new Date(input.birthDate),
            birthTime: input.birthTime,
            occupation: input.occupation,
            birthPlace: input.birthPlace,
          },
        });
      }

      const queueData = {
        user_id: userId,
        astrologerId: input.astrologerId,
        userName: input.name,
        countryCode: input.countryCode,
        mobile: input.mobile,
        gender: input.gender,
        dateOfBirth: new Date(input.birthDate),
        timeOfBirth: input.birthTime,
        occupation: input.occupation,
        location: input.birthPlace,
        astro_id: input.astrologerId,
        is_promotional: false,
        room_id: roomId,
        maximum_time: chatTime,
        user_image: user.profilePic || "",
        phoneNumber: `${input.countryCode}${input.mobile}`,
        createdAt: Date.now(),
        source: input.source,
      };

      if (
        input.requestType.toUpperCase() === "CALL" ||
        input.requestType.toUpperCase() === "CHAT"
      ) {
        const queueLength = await redis.llen(`queue:${input.astrologerId}`);

        if (queueLength > 4) {
          return {
            roomId,
            chatTime,
            intakeId: intake.id,
            message: "Sorry, queue is too long. Please try another astrologer.",
            pricePerMin,
            pricingType: pricing.type,
          };
        }

        // //const userQueueKey = `user_in_queue:${input.astrologerId}`;
        // const userQueueKey = `user_in_queue`;

        // // Check duplicate user
        // const alreadyExists = await redis.sismember(userQueueKey, userId);

        // if (alreadyExists) {
        //   return {
        //     roomId,
        //     chatTime,
        //     intakeId: intake.id,
        //     message:
        //       "Duplicate request. User has already submitted a request.",
        //     pricePerMin,
        //     pricingType: pricing.type,
        //   };
        // }

        const exists = await redis.exists(`request_data:${roomId}`);

        if (exists) return;

        await redis.set(
          `request_data:${roomId}`,
          JSON.stringify(queueData),
          "EX",
          7200,
        );
        await redis.set(
          `cleanup_:${roomId}_${input.astrologerId}_${userId}`,
          JSON.stringify(queueData),
          "EX",
          70,
        );
        await redis.rpush(
          `queue:${input.astrologerId}`,
          JSON.stringify({
            user_id: userId,
            roomId: roomId,
            maximum_time: chatTime,
            source: input.source,
            type: input.requestType.toUpperCase() === "CHAT" ? "chat" : "call",
          }),
        );

        await redis.sadd(userQueueKey, userId);

        // Return Response
        return {
          roomId,
          chatTime,
          intakeId: intake.id,
          message: "request send successfully",
          pricePerMin,
          pricingType: pricing.type,
        };
      }
    },

    createReview: async (_, { input }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        const { astro_id, star, comment } = input;

        // Validate rating
        if (star < 1 || star > 5) {
          throw new Error("Rating must be between 1 and 5");
        }

        // Find latest completed session
        const session = await prisma.session.findFirst({
          where: {
            userId,
            astrologerId: astro_id,
            status: "COMPLETED",
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (!session) {
          throw new Error("No completed session found with this astrologer");
        }

        // Prevent duplicate review for same session
        const existingReview = await prisma.review.findFirst({
          where: {
            userId,
            astrologerId: astro_id,
            sessionId: session.id,
          },
        });

        if (existingReview) {
          throw new Error("Review already submitted");
        }

        // Fetch user + astrologer names
        const [user, astrologer] = await Promise.all([
          prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          }),

          prisma.astrologer.findUnique({
            where: { id: astro_id },
            select: { name: true },
          }),
        ]);

        // Create review
        const review = await prisma.review.create({
          data: {
            userId,
            astrologerId: astro_id,
            sessionId: session.id,

            rating: star,
            comment: comment || null,

            userName: user?.name || null,
            astroName: astrologer?.name || null,

            isFlagged: true,
          },
        });

        // Calculate average rating
        const avgRating = await prisma.review.aggregate({
          where: {
            astrologerId: astro_id,
          },
          _avg: {
            rating: true,
          },
        });

        // Update astrologer rating
        await prisma.astrologer.update({
          where: {
            id: astro_id,
          },
          data: {
            rating: avgRating._avg.rating || 0,
          },
        });

        return {
          success: true,
          message: "Review submitted successfully",
          review,
        };
      } catch (error) {
        console.error("createReview error:", error);

        throw new Error(error.message || "Failed to submit review");
      }
    },
    uploadProfileImage: async (_, { file }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;

        // ================= USER CHECK =================

        const user = await prisma.user.findUnique({
          where: {
            id: userId,
          },
        });

        if (!user) {
          throw new Error("User not found");
        }

        // ================= FILE =================

        const { createReadStream, filename, mimetype } = await file;

        if (!mimetype || !mimetype.startsWith("image/")) {
          throw new Error("Only image files are allowed");
        }

        // ================= FILE SIZE =================

        const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

        // ================= ALLOWED EXTENSIONS =================

        const ext = path.extname(filename).toLowerCase();

        const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

        if (!allowedExtensions.includes(ext)) {
          throw new Error("Only JPG, JPEG, PNG and WEBP images are allowed");
        }

        // ================= UPLOAD DIRECTORY =================

        const uploadRoot =
          process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");

        const uploadDir = path.join(uploadRoot, "profile");

        fs.mkdirSync(uploadDir, {
          recursive: true,
        });

        // ================= UNIQUE FILE NAME =================

        const newFileName = `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)}${ext}`;

        const uploadPath = path.join(uploadDir, newFileName);

        // ================= SAVE FILE =================

        await new Promise((resolve, reject) => {
          const stream = createReadStream();
          const out = fs.createWriteStream(uploadPath);

          let fileSize = 0;
          let rejected = false;

          stream.on("data", (chunk) => {
            fileSize += chunk.length;

            if (fileSize > MAX_FILE_SIZE && !rejected) {
              rejected = true;

              stream.destroy();
              out.destroy();

              if (fs.existsSync(uploadPath)) {
                fs.unlinkSync(uploadPath);
              }

              reject(new Error("Profile image must be less than 2MB"));
            }
          });

          stream.on("error", (error) => {
            if (!rejected) {
              reject(error);
            }
          });

          out.on("error", (error) => {
            if (!rejected) {
              reject(error);
            }
          });

          out.on("finish", () => {
            if (!rejected) {
              resolve();
            }
          });

          stream.pipe(out);
        });

        // ================= PUBLIC URL =================

        const baseUrl =
          process.env.PROFILE_UPLOAD_BASE_URL ||
          "https://dhwaniastro.com/profile/uploads";

        const fileUrl = `${baseUrl}/${newFileName}`;

        // ================= UPDATE USER =================

        const updatedUser = await prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            profileImage: fileUrl,
          },
        });

        // ================= RESPONSE =================

        return {
          success: true,
          message: "Profile image updated successfully",
          url: fileUrl,
          filename: newFileName,
          user: updatedUser,
        };
      } catch (error) {
        console.error("uploadProfileImage error:", error);

        throw new Error(error.message || "Profile image upload failed");
      }
    },
    uploadImage: async (_, { file }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const { createReadStream, filename, mimetype } = await file;

        // Validate image
        if (!mimetype.startsWith("image/")) {
          throw new Error("Only image files are allowed");
        }

        // Generate unique filename
        const ext = path.extname(filename);
        const newFileName = `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)}${ext}`;

        // Upload directory from .env
        const uploadDir =
          process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const uploadPath = path.join(uploadDir, newFileName);

        // Save file
        await new Promise((resolve, reject) => {
          const stream = createReadStream();
          const out = fs.createWriteStream(uploadPath);

          stream.pipe(out);

          out.on("finish", resolve);
          out.on("error", reject);
          stream.on("error", reject);
        });

        // Public URL from .env
        const baseUrl =
          process.env.UPLOAD_BASE_URL || "https://dhwaniastro.com/chat/uploads";

        const fileUrl = `${baseUrl}/${newFileName}`;

        return {
          url: fileUrl,
          filename: newFileName,
        };
      } catch (error) {
        console.error("uploadImage error:", error);
        throw new Error(error.message || "Upload failed");
      }
    },

    // In your resolvers file

    uploadCallRecording: async (
      _,
      { recording, roomId, astroId, astroName, userId, duration, callType },
      context,
    ) => {
      try {
        // Check authentication
        if (!context.user) {
          throw new Error("Unauthorized - Please login to upload recordings");
        }
        const { createReadStream, filename, mimetype } = await recording;

        // Validate file type - allow audio files only
        const allowedMimeTypes = [
          "audio/webm",
          "audio/webm;codecs=opus",
          "audio/ogg",
          "audio/mpeg",
          "audio/mp4",
          "audio/wav",
        ];

        if (
          !allowedMimeTypes.some(
            (type) => mimetype.includes(type) || mimetype.startsWith("audio/"),
          )
        ) {
          throw new Error("Only audio files are allowed for call recordings");
        }

        // Generate unique filename
        const ext = filename.split(".").pop() || "webm";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const newFileName = `call-${roomId}-${timestamp}.${ext}`;

        // Create upload directory with restricted permissions
        const uploadDir = path.join(
          __dirname,
          "..",
          "uploads",
          "call-recordings",
        );
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true, mode: 0o750 });
        }

        console.log("xxxxxxxxxxxxxxxxxxxxxxxxx", uploadDir );
        
        const uploadPath = path.join(uploadDir, newFileName);
        console.log("yyyyyyyyyyyyyyyyyyyyyyy", uploadPath);
        

        // Save file asynchronously
        await new Promise((resolve, reject) => {
          const stream = createReadStream();
          const out = fs.createWriteStream(uploadPath, { mode: 0o640 });

          stream.pipe(out);
          out.on("finish", resolve);
          out.on("error", reject);
          stream.on("error", reject);
        });

        // Get file size
        const stats = fs.statSync(uploadPath);
        const fileSize = stats.size;

        // Generate secure file URL
        const fileToken = Buffer.from(`${roomId}:${Date.now()}`).toString(
          "base64",
        );
        const fileUrl = `https://dhwaniastro.com/v2/uploads/call-recordings/${newFileName}?token=${fileToken}`;

        // Find session by roomId (optional)
        let sessionId = null;
        if (roomId) {
          const session = await prisma.session.findFirst({
            where: { roomId: roomId },
            select: { id: true },
          });
          if (session) {
            sessionId = session.id;
          }
        }

        // Save to database using Prisma - MATCHES YOUR SCHEMA
        const recordingData = await prisma.callRecording.create({
          data: {
            roomId: roomId,
            sessionId: sessionId, // This is a field in your model
            userId: userId || context.user.id,
            astrologerId: astroId,
            astrologerName: astroName || "",
            fileName: newFileName,
            fileUrl: fileUrl,
            filePath: uploadPath,
            fileSize: fileSize,
            duration: parseInt(duration) || 0,
            callType: callType || "audio",
            timestamp: new Date().toISOString(),
            status: "active",
            isAdminOnly: true,
            uploadedBy: context.user.id || context.user.email || "unknown",
            uploadedAt: new Date(),
            metadata: {
              userAgent: context.user?.userAgent || null,
              ipAddress: context.user?.ipAddress || null,
              originalFilename: filename,
              mimeType: mimetype,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                mobile: true,
              },
            },
            astrologer: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
            session: {
              select: {
                id: true,
                status: true,
                type: true,
              },
            },
          },
        });

        return {
          success: true,
          message: "Call recording uploaded successfully (Admin only access)",
          recording: {
            id: recordingData.id,
            roomId: recordingData.roomId,
            astroId: recordingData.astrologerId,
            astroName: recordingData.astrologerName,
            userId: recordingData.userId,
            duration: recordingData.duration,
            callType: recordingData.callType,
            recordingUrl: recordingData.fileUrl,
            createdAt: recordingData.createdAt.toISOString(),
            updatedAt: recordingData.updatedAt.toISOString(),
          },
          fileUrl: fileUrl,
        };
      } catch (error) {
        console.error("uploadCallRecording error:", error);
        return {
          success: false,
          message: error.message || "Failed to upload call recording",
          recording: null,
          fileUrl: null,
        };
      }
    },

    verifyServiceCoupon: async (_, { input }, context) => {
      try {
        // Authentication check
        if (!context.user) {
          throw new Error("Unauthorized: Please login to apply coupon");
        }

        const userId = context.user.id;
        const { bookingId, couponCode } = input;

        // Validate booking
        const booking = await prisma.serviceBooking.findUnique({
          where: { id: bookingId },
          include: {
            service: true,
            astrologer: true,
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }

        // Check if booking belongs to user
        if (booking.userId !== userId) {
          throw new Error(
            "You are not authorized to apply coupon on this booking",
          );
        }

        // Check if booking is already paid
        if (booking.status === "PAID" || booking.status === "COMPLETED") {
          throw new Error("Cannot apply coupon on already paid booking");
        }

        // Calculate total amount with GST
        const originalAmount = Number(booking.amount);
        const gstAmount = (originalAmount * 18) / 100;
        const totalAmount = originalAmount + gstAmount;

        // Validate coupon
        const coupon = await prisma.coupon.findUnique({
          where: {
            code: couponCode.trim().toUpperCase(),
          },
        });

        if (!coupon) {
          throw new Error("Invalid coupon code");
        }

        // Check coupon status
        if (!coupon.status) {
          throw new Error("Coupon is currently inactive");
        }

        // Check coupon validity dates
        const now = new Date();
        if (coupon.startDate > now) {
          throw new Error(
            `Coupon is not active yet. Valid from ${coupon.startDate.toLocaleDateString()}`,
          );
        }

        if (coupon.endDate < now) {
          throw new Error(
            `Coupon has expired on ${coupon.endDate.toLocaleDateString()}`,
          );
        }

        // Check redeem limit
        if (coupon.redeemLimit && coupon.usedCount >= coupon.redeemLimit) {
          throw new Error("Coupon redemption limit has been reached");
        }

        // Check minimum order amount
        if (coupon.minOrderAmount && totalAmount < coupon.minOrderAmount) {
          throw new Error(
            `Minimum order amount of ₹${coupon.minOrderAmount} is required for this coupon`,
          );
        }

        // Check if coupon is applicable for service
        if (
          coupon.applicable &&
          coupon.applicable !== "SERVICE" &&
          coupon.applicable !== "BOTH"
        ) {
          throw new Error("This coupon is not applicable for services");
        }

        // Check if user has already used this coupon (for paid bookings only)
        const alreadyUsed = await prisma.servicePaymentOrder.findFirst({
          where: {
            userId: userId,
            couponId: coupon.id,
            status: "PAID",
          },
        });

        if (alreadyUsed) {
          throw new Error(
            "You have already used this coupon for a previous booking",
          );
        }

        // Calculate discount
        let discount = 0;
        let cashback = 0;
        let payableAmount = totalAmount;

        if (coupon.type === "FLAT") {
          discount = coupon.flatAmount || 0;
          discount = Math.min(discount, totalAmount);
          payableAmount = totalAmount - discount;
        } else if (coupon.type === "DISCOUNT") {
          discount = (totalAmount * (coupon.percentage || 0)) / 100;

          if (coupon.maxDiscount && discount > coupon.maxDiscount) {
            discount = coupon.maxDiscount;
          }

          discount = Math.min(discount, totalAmount);
          payableAmount = totalAmount - discount;
        } else if (coupon.type === "CASHBACK") {
          cashback = (totalAmount * (coupon.percentage || 0)) / 100;

          if (coupon.maxDiscount && cashback > coupon.maxDiscount) {
            cashback = coupon.maxDiscount;
          }

          // For cashback, total amount remains same but cashback is calculated
          payableAmount = totalAmount;
        }

        // Format response
        return {
          success: true,
          message: "Coupon verified successfully",
          coupon: {
            ...coupon,
            // Convert Decimal to number if using Prisma Decimal
            flatAmount: coupon.flatAmount ? Number(coupon.flatAmount) : null,
            maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
            minOrderAmount: coupon.minOrderAmount
              ? Number(coupon.minOrderAmount)
              : null,
          },
          totalAmount: totalAmount,
          discount: discount,
          cashback: cashback,
          payableAmount: Math.round(payableAmount * 100) / 100,
          gstAmount: gstAmount,
          originalAmount: originalAmount,
        };
      } catch (error) {
        console.error("Coupon verification error:", error);
        return {
          success: false,
          message: error.message || "Failed to verify coupon",
          coupon: null,
          totalAmount: 0,
          discount: 0,
          cashback: 0,
          payableAmount: 0,
          gstAmount: 0,
          originalAmount: 0,
        };
      }
    },

    createOrder: async (_, { input }, context) => {
      try {
        // ======================
        // AUTH CHECK
        // ======================
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;
        const { rechargePackId, coupan_code } = input;

        // ======================
        // VALIDATE RECHARGE PACK
        // ======================
        const pack = await prisma.rechargePack.findUnique({
          where: {
            id: rechargePackId,
          },
        });

        if (!pack) {
          throw new Error("Recharge pack not found");
        }

        // ======================
        // DEFAULT VALUES
        // ======================
        let coupon = null;
        let discount = 0;
        let cashback = 0;
        let finalAmount = pack.price;

        // ======================
        // APPLY COUPON (OPTIONAL)
        // ======================
        if (coupan_code && coupan_code.trim() !== "") {
          coupon = await prisma.coupon.findUnique({
            where: {
              code: coupan_code.trim(),
            },
            include: {
              rechargePacks: true,
            },
          });

          if (!coupon) {
            throw new Error("Invalid coupon code");
          }

          const now = new Date();

          // Coupon Active
          if (!coupon.status) {
            throw new Error("Coupon is inactive");
          }

          // Coupon Start Date
          if (coupon.startDate > now) {
            throw new Error("Coupon is not active yet");
          }

          // Coupon Expiry
          if (coupon.endDate < now) {
            throw new Error("Coupon has expired");
          }

          // Redeem Limit
          if (coupon.redeemLimit && coupon.usedCount >= coupon.redeemLimit) {
            throw new Error("Coupon redemption limit exceeded");
          }

          // Minimum Order Amount
          if (coupon.minOrderAmount && pack.price < coupon.minOrderAmount) {
            throw new Error(
              `Minimum recharge amount should be ₹${coupon.minOrderAmount}`,
            );
          }

          // Applicable Recharge Pack
          if (
            coupon.rechargePacks.length > 0 &&
            !coupon.rechargePacks.some((p) => p.id === pack.id)
          ) {
            throw new Error("Coupon is not applicable for this recharge pack");
          }

          // ======================
          // CALCULATE DISCOUNT
          // ======================
          if (coupon.type === "DISCOUNT") {
            // Percentage discount
            discount = (pack.price * (coupon.percentage || 0)) / 100;

            if (coupon.maxDiscount && discount > coupon.maxDiscount) {
              discount = coupon.maxDiscount;
            }
            discount = Math.min(discount, pack.price);
            finalAmount = pack.price - discount;
            // GST on discounted amount (if your business logic requires it)
            finalAmount += (finalAmount * 18) / 100;
          } else if (coupon.type === "CASHBACK") {
            // Customer pays full amount
            finalAmount = pack.price;

            // GST on full amount
            finalAmount += (finalAmount * 18) / 100;

            // Cashback amount to be credited later
            cashback = (pack.price * (coupon.percentage || 0)) / 100;

            if (coupon.maxDiscount && cashback > coupon.maxDiscount) {
              cashback = coupon.maxDiscount;
            }

            cashback = Math.min(cashback, pack.price);
          }
        } else {
          //-----NORMAL RECHARGE WITHOUT COUPAN
          finalAmount += (finalAmount * 18) / 100;
        }

        // ======================
        // CREATE RAZORPAY ORDER
        // ======================

        const notes = {
          userId,
          rechargePackId: pack.id,
          coins: pack.coins,
          couponCode: coupon?.code || "",
          type: coupon?.type || "NORMAL",
        };

        if (coupon?.type === "DISCOUNT") {
          notes.discount = discount.toString();
        }

        if (coupon?.type === "CASHBACK") {
          notes.cashback = cashback.toString();
        }
        const receiptId = uuidv4();
        const order = await razorpay.orders.create({
          amount: Math.round(finalAmount * 100), // paise
          currency: "INR",
          receipt: receiptId,
          notes,
        });

        // ======================
        // SAVE PAYMENT ORDER
        // ======================
        await prisma.paymentOrder.create({
          data: {
            userId,
            rechargePackId: pack.id,
            couponId: coupon?.id || null,
            razorpayOrderId: order.id,

            originalAmount: pack.price,
            discount: discount,
            amount: finalAmount,

            coins: pack.coins,
            status: "CREATED",
          },
        });

        return {
          success: true,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
        };
      } catch (error) {
        console.error("createOrder error:", error);
        throw new Error(error.message || "Failed to create order");
      }
    },

    createHealingOrder: async (_, { input }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const userId = context.user.id;
        const { bookingId, couponCode, amount } = input;
        const booking = await prisma.serviceBooking.findUnique({
          where: {
            id: bookingId,
          },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }

        const totalAmount = Number(amount);

        if (!totalAmount || totalAmount <= 0) {
          throw new Error("Invalid amount");
        }

        let coupon = null;
        let discount = 0;
        let cashback = 0;

        let payableAmount = totalAmount;

        // =====================================
        // APPLY COUPON
        // =====================================

        if (couponCode && couponCode.trim() !== "") {
          coupon = await prisma.coupon.findUnique({
            where: {
              code: couponCode.trim(),
            },
          });

          if (!coupon) {
            throw new Error("Invalid coupon");
          }

          const now = new Date();

          if (!coupon.status) throw new Error("Coupon inactive");

          if (coupon.startDate > now) throw new Error("Coupon not started");

          if (coupon.endDate < now) throw new Error("Coupon expired");

          if (coupon.redeemLimit && coupon.usedCount >= coupon.redeemLimit) {
            throw new Error("Coupon exhausted");
          }

          if (coupon.minOrderAmount && totalAmount < coupon.minOrderAmount) {
            throw new Error(
              `Minimum amount should be ₹${coupon.minOrderAmount}`,
            );
          }

          //--------------------------------------
          // DISCOUNT
          //--------------------------------------

          if (coupon.type === "DISCOUNT") {
            discount = (totalAmount * (coupon.percentage || 0)) / 100;

            if (coupon.maxDiscount && discount > coupon.maxDiscount) {
              discount = coupon.maxDiscount;
            }

            discount = Math.min(discount, totalAmount);

            payableAmount = totalAmount - discount;
          }

          //--------------------------------------
          // CASHBACK
          //--------------------------------------

          if (coupon.type === "CASHBACK") {
            payableAmount = totalAmount;

            cashback = (totalAmount * (coupon.percentage || 0)) / 100;

            if (coupon.maxDiscount && cashback > coupon.maxDiscount) {
              cashback = coupon.maxDiscount;
            }
          }
        }

        const receiptId = uuidv4();

        const order = await razorpay.orders.create({
          amount: Math.round(payableAmount * 100),
          currency: "INR",
          receipt: receiptId,

          notes: {
            bookingId: booking.id,
            serviceId: booking.serviceId,
            astrologerId: booking.astrologerId,
            userId,

            serviceType: "SERVICE",

            couponCode: coupon?.code || "",
            couponType: coupon?.type || "",

            discount: discount.toString(),
            cashback: cashback.toString(),
          },
        });

        //--------------------------------------
        // SAVE ORDER
        //--------------------------------------

        await prisma.servicePaymentOrder.create({
          data: {
            userId,
            bookingId: booking.id,
            razorpayOrderId: order.id,
            totalAmount,
            walletAmount: 0,
            payableAmount,
            status: "CREATED",
          },
        });

        return {
          success: true,
          orderId: order.id,
          currency: "INR",

          bookingId: booking.id,

          totalAmount,
          payableAmount,
        };
      } catch (error) {
        console.error("createHealingOrder error:", error);

        throw new Error(error.message || "Failed to create healing order");
      }
    },

    // new astrologer
    // new astrologer
    createAstrologerApplication: async (_, { input }) => {
      try {
        if (!input.phoneNumber || !input.name) {
          throw new Error("Required fields missing");
        }

        const newApp = await prisma.astrologerApplication.create({
          data: {
            name: input.name,
            phoneNumber: input.phoneNumber,
            email: input.email,
            dob: input.dob ? new Date(input.dob) : null,
            gender: input.gender,
            languages: input.languages || [],
            problems: input.problems || [],
            skills: input.skills || [],
            experience: Number(input.experience) || 0,
            about: input.about || "",
            address: input.address || "",
            pincode: input.pincode || "",
          },
        });

        return newApp;
      } catch (error) {
        console.error("FULL ERROR:", error);
        throw error;
      }
    },

    logout: async (_, __, { user, res }) => {
      try {
        if (!user) throw new Error("Unauthorized");

        await prisma.user.update({
          where: { id: user.id },
          data: { refreshToken: null },
        });

        if (res?.setHeader) {
          res.setHeader("Set-Cookie", [
            cookie.serialize("accessToken", "", {
              httpOnly: true,
              expires: new Date(0),
              path: "/",
            }),
            cookie.serialize("refreshToken", "", {
              httpOnly: true,
              expires: new Date(0),
              path: "/",
            }),
          ]);
        }

        // Log logout
        await logEvent({ userId: user.id, action: "LOGOUT" });

        return true;
      } catch (error) {
        throw new Error(error.message || "Failed to logout");
      }
    },
    // sendGift: async (_, { input }, context) => {

    //   try {
    //     if (!context.user) {
    //       throw new Error("Unauthorized");
    //     }

    //     const { astro_id, gift_id, giftname, giftprice, user_id } = input;

    //     // -----------------------------
    //     // Fetch wallets
    //     // -----------------------------
    //     const userWallet = await prisma.userWallet.findUnique({
    //       where: {
    //         userId: user_id,
    //       },
    //     });
    //     if (!userWallet) {
    //       throw new Error("User wallet not found");
    //     }

    //     if (Number(userWallet.balanceCoins) < Number(giftprice)) {
    //       throw new Error("Insufficient wallet balance");
    //     }

    //     const astrologerWallet = await prisma.astrologerWallet.findUnique({
    //       where: {
    //         astrologerId: astro_id,
    //       },
    //     });
    //     console.log("Astrologer Wallet:", astrologerWallet);

    //     // if (!astrologerWallet) {
    //     //   throw new Error("Astrologer wallet not found");
    //     // }

    //     // -----------------------------
    //     // Transaction
    //     // -----------------------------
    //     const result = await prisma.$transaction(async (tx) => {
    //       // Debit User Wallet
    //       const updatedUserWallet = await tx.userWallet.update({
    //         where: {
    //           id: userWallet.id,
    //         },
    //         data: {
    //           balanceCoins: {
    //             decrement: Number(giftprice),
    //           },
    //         },
    //       });

    //       // Credit Astrologer Wallet
    //       const updatedAstroWallet = await tx.astrologerWallet.update({
    //         where: {
    //           id: astrologerWallet.id,
    //         },
    //         data: {
    //           balanceCoins: {
    //             increment: Number(giftprice),
    //           },
    //         },
    //       });

    //       // Save Gift History
    //       await tx.giftHistory.create({
    //         data: {
    //           userId: user_id,
    //           astrologerId: astro_id,
    //           giftId: gift_id,
    //           giftName: giftname,
    //           giftPrice: Number(giftprice),
    //         },
    //       });

    //       // User Wallet Transaction
    //       await tx.walletTransaction.create({
    //         data: {
    //           userWalletId: userWallet.id,

    //           type: "DEBIT",

    //           coins: Number(giftprice),
    //           amount: Number(giftprice),

    //           description: `Gift Sent - ${giftname}`,
    //         },
    //       });

    //       // Astrologer Wallet Transaction
    //       await tx.walletTransaction.create({
    //         data: {
    //           astrologerWalletId: astrologerWallet.id,

    //           type: "CREDIT",

    //           coins: Number(giftprice),
    //           amount: Number(giftprice),

    //           description: `Gift Received - ${giftname}`,
    //         },
    //       });

    //       return {
    //         updatedUserWallet,
    //         updatedAstroWallet,
    //       };
    //     });

    //     return {
    //       success: true,
    //       message: "Gift sent successfully",

    //       userBalance: result.updatedUserWallet.balanceCoins,

    //       astrologerBalance: result.updatedAstroWallet.balanceCoins,
    //     };
    //   } catch (error) {
    //     console.error("sendGift error:", error);

    //     throw new Error(error.message);
    //   }
    // },

    sendGift: async (_, { input }, context) => {
      try {
        if (!context.user) {
          throw new Error("Unauthorized");
        }

        const { astro_id, gift_id, giftname, giftprice, user_id } = input;

        const giftPrice = Number(giftprice);

        if (!astro_id || !gift_id || !user_id) {
          throw new Error("Missing required gift details");
        }

        if (!Number.isFinite(giftPrice) || giftPrice <= 0) {
          throw new Error("Invalid gift price");
        }

        // --------------------------------------------------
        // Fetch User Wallet
        // --------------------------------------------------
        const userWallet = await prisma.userWallet.findUnique({
          where: {
            userId: user_id,
          },
        });

        if (!userWallet) {
          throw new Error("User wallet not found");
        }

        // --------------------------------------------------
        // Check User Balance
        // --------------------------------------------------
        if (Number(userWallet.balanceCoins) < giftPrice) {
          throw new Error("Insufficient wallet balance");
        }

        // --------------------------------------------------
        // Fetch Astrologer Wallet
        // --------------------------------------------------
        const astrologerWallet = await prisma.astrologerWallet.findUnique({
          where: {
            astrologerId: astro_id,
          },
        });

        // if (!astrologerWallet) {
        //   throw new Error("Astrologer wallet not found");
        // }

        // --------------------------------------------------
        // Fetch Gift Commission
        // --------------------------------------------------
        const giftCommissionPricing = await prisma.astrologerPricing.findFirst({
          where: {
            astrologerId: astro_id,
            type: "GIFT_COMMISSION",
            isActive: true,
          },
          select: {
            commissionPercent: true,
          },
        });

        if (!giftCommissionPricing) {
          throw new Error(
            "Gift commission configuration not found for astrologer",
          );
        }

        const commissionPercent = Number(
          giftCommissionPricing.commissionPercent,
        );

        if (
          !Number.isFinite(commissionPercent) ||
          commissionPercent < 0 ||
          commissionPercent > 100
        ) {
          throw new Error("Invalid gift commission percentage");
        }

        // --------------------------------------------------
        // Calculate Astrologer Earning
        // --------------------------------------------------
        const astrologerEarning = Number(
          ((giftPrice * commissionPercent) / 100).toFixed(2),
        );

        const platformEarning = Number(
          (giftPrice - astrologerEarning).toFixed(2),
        );
        // --------------------------------------------------
        // Transaction
        // --------------------------------------------------
        const result = await prisma.$transaction(async (tx) => {
          // ------------------------------------------------
          // Debit User Wallet
          // ------------------------------------------------
          const updatedUserWallet = await tx.userWallet.update({
            where: {
              id: userWallet.id,
            },
            data: {
              balanceCoins: {
                decrement: giftPrice,
              },
            },
          });

          // ------------------------------------------------
          // Credit Astrologer Wallet
          // ONLY COMMISSION AMOUNT
          // ------------------------------------------------
          const updatedAstroWallet = await tx.astrologerWallet.update({
            where: {
              id: astrologerWallet.id,
            },
            data: {
              balanceCoins: {
                increment: astrologerEarning,
              },
            },
          });

          // ------------------------------------------------
          // Save Gift History
          // ------------------------------------------------
          await tx.giftHistory.create({
            data: {
              userId: user_id,
              astrologerId: astro_id,
              giftId: gift_id,
              giftName: giftname,
              giftPrice: giftPrice,
            },
          });

          // ------------------------------------------------
          // User Wallet Transaction
          // ------------------------------------------------
          await tx.walletTransaction.create({
            data: {
              userWalletId: userWallet.id,

              type: "DEBIT",

              coins: giftPrice,
              amount: giftPrice,

              description: `Gift Sent - ${giftname}`,
            },
          });

          // ------------------------------------------------
          // Astrologer Wallet Transaction
          // ------------------------------------------------
          await tx.walletTransaction.create({
            data: {
              astrologerWalletId: astrologerWallet.id,

              type: "CREDIT",

              coins: astrologerEarning,
              amount: astrologerEarning,

              description: `Gift Received - ${giftname} (${commissionPercent}% commission)`,
            },
          });

          return {
            updatedUserWallet,
            updatedAstroWallet,
          };
        });

        return {
          success: true,
          message: "Gift sent successfully",

          userBalance: result.updatedUserWallet.balanceCoins,

          astrologerBalance: result.updatedAstroWallet.balanceCoins,

          giftPrice,

          commissionPercent,

          astrologerEarning,

          platformEarning,
        };
      } catch (error) {
        console.error("sendGift error:", error);

        throw new Error(error.message);
      }
    },
    followAstrologer: async (_, { astrologerId }, context) => {
      try {
        const { user } = context;

        if (!user) {
          throw new Error("Unauthorized");
        }

        const astrologer = await prisma.astrologer.findUnique({
          where: {
            id: astrologerId,
          },
        });
        if (!astrologer) {
          throw new Error("Astrologer not found");
        }

        const existingFollow = await prisma.astrologerFollow.findUnique({
          where: {
            userId_astrologerId: {
              userId: user.id,
              astrologerId,
            },
          },
        });

        if (existingFollow) {
          throw new Error("Already following this astrologer");
        }

        await prisma.astrologerFollow.create({
          data: {
            userId: user.id,
            astrologerId,
          },
        });

        return {
          success: true,
          message: "Astrologer followed successfully",
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },
    unfollowAstrologer: async (_, { astrologerId }, context) => {
      try {
        const { user } = context;

        if (!user) {
          throw new Error("Unauthorized");
        }

        await prisma.astrologerFollow.delete({
          where: {
            userId_astrologerId: {
              userId: user.id,
              astrologerId,
            },
          },
        });

        return {
          success: true,
          message: "Astrologer unfollowed successfully",
        };
      } catch (error) {
        throw new Error(error.message);
      }
    },

    createServiceBooking: async (_, { input }, { user }) => {
      if (!user) {
        throw new Error("Unauthorized");
      }

      const service = await prisma.service.findUnique({
        where: {
          id: input.serviceId,
        },
      });

      if (!service) {
        throw new Error("Service not found");
      }

      return prisma.serviceBooking.create({
        data: {
          ...input,
          userId: user.id,
          amount: null,
        },
      });
    },

    updateBookingAstrologer: async (_, { bookingId, astrologerId }) => {
      // Check booking
      const booking = await prisma.serviceBooking.findUnique({
        where: {
          id: bookingId,
        },
      });

      if (!booking) {
        throw new Error("Booking not found");
      }

      // Check astrologer
      const astrologer = await prisma.astrologer.findUnique({
        where: {
          id: astrologerId,
        },
      });

      if (!astrologer) {
        throw new Error("Astrologer not found");
      }

      // Find service-astrologer mapping
      const mapping = await prisma.serviceAstrologer.findFirst({
        where: {
          serviceId: booking.serviceId,
          astrologerId,
        },
      });

      if (!mapping) {
        throw new Error(
          "Selected astrologer is not available for this service",
        );
      }

      // Update booking
      return prisma.serviceBooking.update({
        where: {
          id: bookingId,
        },
        data: {
          astrologerId,
          amount: mapping.price,
        },
        include: {
          astrologer: true,
          service: true,
        },
      });
    },

    confirmWalletBooking: async (
      _,
      { bookingId, astrologerId, walletAmount },
      { user },
    ) => {
      const result = await prisma.$transaction(async (tx) => {
        const booking = await tx.serviceBooking.findUnique({
          where: { id: bookingId },
        });

        if (!booking) {
          throw new Error("Booking not found");
        }

        const wallet = await tx.userWallet.findUnique({
          where: { userId: user.id },
        });

        if (!wallet || wallet.balanceCoins < walletAmount) {
          throw new Error("Insufficient wallet balance");
        }

        await tx.userWallet.update({
          where: { userId: user.id },
          data: {
            balanceCoins: {
              decrement: walletAmount,
            },
          },
        });

        const updatedBooking = await tx.serviceBooking.update({
          where: { id: bookingId },
          data: {
            astrologerId,
            bookingStatus: "COMPLETED", // or ASSIGNED as per your flow
            paymentStatus: "SUCCESS",
          },
          include: {
            astrologer: true,
            service: true,
          },
        });

        return updatedBooking;
      });

      return {
        success: true,
        message: "Booking confirmed successfully",
        booking: result,
      };
    },
    startLive: async (_, { title }, { user }) => {
      try {
        if (!user) {
          throw new Error("Unauthorized");
        }

        let stream = await prisma.liveStream.findFirst({
          where: {
            astrologerId: user.id,
            status: "SCHEDULED",
          },
          orderBy: {
            scheduledAt: "asc",
          },
        });

        if (stream) {
          stream = await prisma.liveStream.update({
            where: {
              id: stream.id,
            },
            data: {
              status: "LIVE",
            },
          });
        } else {
          stream = await prisma.liveStream.create({
            data: {
              astrologerId: user.id,
              title,
              channelName: `astro-${user.id}`,
              status: "LIVE",
            },
          });
        }

        const uid = Math.floor(Math.random() * 100000);

        const token = generateRtcToken({
          channelName: stream.channelName,
          uid,
          role: "publisher",
        });

        return {
          token,
          uid,
          appId: process.env.AGORA_APP_ID || "3a1816ebf7bf47b094c7540e2cf2aac0",
          channelName: stream.channelName,
        };
      } catch (error) {
        console.error("startLive Error:", error);

        throw new Error(error.message || "Failed to start live");
      }
    },
  },
};
